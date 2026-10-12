import os
import base64
import hashlib
import pickle
import re
import traceback
from pathlib import Path
from collections import Counter

import faiss
import numpy as np
import tiktoken
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from openai import AzureOpenAI
from PyPDF2 import PdfReader
from docx import Document

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024


@app.errorhandler(Exception)
def handle_exception(e):
    print(f"[UNHANDLED ERROR] {traceback.format_exc()}")
    return jsonify({"error": f"{type(e).__name__}: {str(e)}"}), 500


@app.errorhandler(413)
def handle_too_large(e):
    return jsonify({"error": "File too large (max 50MB)"}), 413


BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
VECTOR_DIR = BASE_DIR / "vector_store"
UPLOAD_DIR.mkdir(exist_ok=True)
VECTOR_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "txt"}

# Main client (chat + embeddings)
client = AzureOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    api_version=os.getenv("OPENAI_API_VERSION"),
    azure_endpoint=os.getenv("OPENAI_BASE_URL"),
)

# Audio client (Whisper transcription)
audio_client = AzureOpenAI(
    api_key=os.getenv("AZURE_AUDIO_API_KEY"),
    api_version=os.getenv("OPENAI_API_VERSION", "2024-12-01-preview"),
    azure_endpoint=os.getenv("AZURE_AUDIO_ENDPOINT"),
) if os.getenv("AZURE_AUDIO_API_KEY") else None

# Vision client (image analysis)
vision_client = AzureOpenAI(
    api_key=os.getenv("AZURE_VISION_API_KEY"),
    api_version=os.getenv("OPENAI_API_VERSION", "2024-12-01-preview"),
    azure_endpoint=os.getenv("AZURE_VISION_ENDPOINT"),
) if os.getenv("AZURE_VISION_API_KEY") else None

EMBED_MODEL = os.getenv("AZURE_EMBED_MODEL", "text-embedding-3-large")
CHAT_MODEL = os.getenv("MODEL_DEPLOYMENT_NAME", "gpt-4.1-mini")
VISION_MODEL = os.getenv("AZURE_VISION_MODEL", "gpt-4.1-mini")  # must support vision

# FIX #7: Auto-detect embedding dimension on first call instead of hardcoding
EMBED_DIM = None


# ── In-memory knowledge base ──────────────────────────────────────────────────
chunks_store: list[dict] = []   # {id, text, source, chunk_idx}
embeddings_store: np.ndarray | None = None  # FIX #2: store raw embeddings
index: faiss.IndexFlatIP | None = None
doc_registry: dict[str, dict] = {}


def _load_state():
    global chunks_store, index, doc_registry, embeddings_store, EMBED_DIM
    meta_path = VECTOR_DIR / "meta.pkl"
    idx_path = VECTOR_DIR / "index.faiss"
    emb_path = VECTOR_DIR / "embeddings.npy"
    if meta_path.exists() and idx_path.exists():
        with open(meta_path, "rb") as f:
            data = pickle.load(f)
        chunks_store = data["chunks"]
        doc_registry = data["doc_registry"]
        index = faiss.read_index(str(idx_path))
        EMBED_DIM = index.d
        if emb_path.exists():
            embeddings_store = np.load(str(emb_path))


def _save_state():
    with open(VECTOR_DIR / "meta.pkl", "wb") as f:
        pickle.dump({"chunks": chunks_store, "doc_registry": doc_registry}, f)
    if index is not None:
        faiss.write_index(index, str(VECTOR_DIR / "index.faiss"))
    if embeddings_store is not None:
        np.save(str(VECTOR_DIR / "embeddings.npy"), embeddings_store)


_load_state()


# ── Text extraction ───────────────────────────────────────────────────────────
def extract_text_pdf(path: str) -> str:
    reader = PdfReader(path)
    return "\n".join(p.extract_text() or "" for p in reader.pages)


# FIX #13: Extract paragraphs AND tables from docx
def extract_text_docx(path: str) -> str:
    doc = Document(path)
    parts = []
    for element in doc.element.body:
        tag = element.tag.split("}")[-1]
        if tag == "p":
            text = element.text.strip()
            if text:
                parts.append(text)
        elif tag == "tbl":
            for row in element.findall(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tr"):
                cells = []
                for cell in row.findall("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tc"):
                    cell_text = " ".join(
                        p.text for p in cell.findall(
                            ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
                        ) if p.text
                    )
                    cells.append(cell_text.strip())
                if any(cells):
                    parts.append(" | ".join(cells))
    return "\n".join(parts)


def extract_text_txt(path: str) -> str:
    with open(path, "r", errors="ignore") as f:
        return f.read()


EXTRACTORS = {
    "pdf": extract_text_pdf,
    "docx": extract_text_docx,
    "doc": extract_text_docx,
    "txt": extract_text_txt,
}


# ── Chunking (FIX #5: real token counting with tiktoken) ─────────────────────
try:
    _enc = tiktoken.encoding_for_model("gpt-4")
except Exception:
    _enc = tiktoken.get_encoding("cl100k_base")


def chunk_text(text: str, max_tokens: int = 400, overlap_tokens: int = 50) -> list[str]:
    tokens = _enc.encode(text)
    chunks = []
    i = 0
    while i < len(tokens):
        chunk_tokens = tokens[i : i + max_tokens]
        chunk_text_str = _enc.decode(chunk_tokens).strip()
        if chunk_text_str:
            chunks.append(chunk_text_str)
        i += max_tokens - overlap_tokens
    return chunks


# ── Embedding ─────────────────────────────────────────────────────────────────
def get_embeddings(texts: list[str]) -> np.ndarray:
    global EMBED_DIM
    batch_size = 16
    all_embs = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        resp = client.embeddings.create(input=batch, model=EMBED_MODEL)
        embs = [d.embedding for d in resp.data]
        all_embs.extend(embs)
    result = np.array(all_embs, dtype="float32")
    # FIX #7: auto-detect dimension from first real response
    if EMBED_DIM is None:
        EMBED_DIM = result.shape[1]
    return result


def normalize_embeddings(embs: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return embs / norms


# ── Dedup helper (FIX #6: normalize whitespace, use SHA256) ───────────────────
def content_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.strip())
    return hashlib.sha256(normalized.encode()).hexdigest()


# ── Sample prompt generation (FIX #17: better topic extraction) ───────────────
def generate_sample_prompts() -> list[str]:
    if not doc_registry:
        return [
            "Upload a document to get started!",
            "I can answer questions about your documents.",
            "Try uploading a PDF, Word doc, or paste text.",
        ]

    doc_count = len(doc_registry)
    doc_names = [d["name"] for d in doc_registry.values()]

    all_keywords = []
    for d in doc_registry.values():
        all_keywords.extend(d.get("keywords", []))
    top = [w for w, _ in Counter(all_keywords).most_common(8)]

    prompts = []
    if doc_count == 1:
        prompts.append(f"Summarize the key points from {doc_names[0]}")
    else:
        prompts.append(f"Compare the main ideas across all {doc_count} documents")

    if top:
        prompts.append(f"What does the document say about '{top[0]}'?")
    if len(top) > 2:
        prompts.append(f"How are '{top[1]}' and '{top[2]}' related?")

    prompts.append("List all important facts")

    if doc_count > 1 and len(top) > 0:
        prompts.append(f"Which document covers '{top[0]}' the most?")

    return prompts[:5]


def extract_keywords(text: str) -> list[str]:
    stop = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "shall", "can", "need", "dare", "ought",
        "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
        "as", "into", "through", "during", "before", "after", "above", "below",
        "between", "out", "off", "over", "under", "again", "further", "then",
        "once", "here", "there", "when", "where", "why", "how", "all", "each",
        "every", "both", "few", "more", "most", "other", "some", "such", "no",
        "nor", "not", "only", "own", "same", "so", "than", "too", "very",
        "and", "but", "or", "if", "while", "this", "that", "these", "those",
        "it", "its", "i", "me", "my", "we", "our", "you", "your", "he", "him",
        "his", "she", "her", "they", "them", "their", "what", "which", "who",
        "also", "just", "about", "like", "been", "such", "new", "one", "two",
        "first", "last", "next", "data", "using", "based", "make", "use",
    }
    words = re.findall(r"[a-zA-Z]{3,}", text.lower())
    freq = Counter(w for w in words if w not in stop)
    return [w for w, _ in freq.most_common(15)]


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload_files():
    global index, embeddings_store

    files = request.files.getlist("files")
    pasted_text = request.form.get("pasted_text", "").strip()

    if not files and not pasted_text:
        return jsonify({"error": "No files or text provided"}), 400

    new_chunks = []
    processed = []
    # FIX #10: counter for unique pasted text names
    paste_count = sum(1 for d in doc_registry.values() if d["name"].startswith("Pasted Text"))

    for f in files:
        if not f.filename:
            continue
        ext = f.filename.rsplit(".", 1)[-1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            continue

        save_path = UPLOAD_DIR / f.filename
        f.save(str(save_path))

        try:
            text = EXTRACTORS.get(ext, extract_text_txt)(str(save_path))
        except Exception as e:
            processed.append({"name": f.filename, "status": "error", "error": f"Extract failed: {e}"})
            print(f"[EXTRACT ERROR] {f.filename}: {e}")
            continue

        if not text.strip():
            processed.append({"name": f.filename, "status": "error", "error": "No text extracted"})
            continue

        file_hash = content_hash(text)
        if file_hash in doc_registry:
            processed.append({"name": f.filename, "status": "duplicate"})
            continue

        file_chunks = chunk_text(text)
        keywords = extract_keywords(text)
        doc_registry[file_hash] = {
            "name": f.filename,
            "summary": text[:500],
            "keywords": keywords,
        }

        for ci, chunk in enumerate(file_chunks):
            new_chunks.append({
                "id": len(chunks_store) + len(new_chunks),
                "text": chunk,
                "source": f.filename,
                "chunk_idx": ci,
            })
        processed.append({"name": f.filename, "status": "success", "chunks": len(file_chunks)})

    if pasted_text:
        text_hash = content_hash(pasted_text)
        if text_hash not in doc_registry:
            paste_count += 1
            paste_name = f"Pasted Text #{paste_count}" if paste_count > 1 else "Pasted Text"
            pasted_chunks = chunk_text(pasted_text)
            keywords = extract_keywords(pasted_text)
            doc_registry[text_hash] = {
                "name": paste_name,
                "summary": pasted_text[:500],
                "keywords": keywords,
            }
            for ci, chunk in enumerate(pasted_chunks):
                new_chunks.append({
                    "id": len(chunks_store) + len(new_chunks),
                    "text": chunk,
                    "source": paste_name,
                    "chunk_idx": ci,
                })
            processed.append({"name": paste_name, "status": "success", "chunks": len(pasted_chunks)})
        else:
            processed.append({"name": "Pasted Text", "status": "duplicate"})

    if new_chunks:
        try:
            texts = [c["text"] for c in new_chunks]
            new_embeddings = get_embeddings(texts)
            new_embeddings = normalize_embeddings(new_embeddings)

            if index is None:
                index = faiss.IndexFlatIP(EMBED_DIM)
                embeddings_store = new_embeddings
            else:
                embeddings_store = np.vstack([embeddings_store, new_embeddings])

            index.add(new_embeddings)
            chunks_store.extend(new_chunks)
            _save_state()
        except Exception as e:
            for p in processed:
                if p["status"] == "success":
                    to_remove = [h for h, d in doc_registry.items() if d["name"] == p["name"]]
                    for h in to_remove:
                        doc_registry.pop(h, None)
                    p["status"] = "error"
                    p["error"] = str(e)
            print(f"[EMBEDDING ERROR] {e}")
            return jsonify({
                "processed": processed, "total_chunks": len(chunks_store),
                "sample_prompts": generate_sample_prompts(),
                "error": f"Embedding generation failed: {str(e)}"
            })

    return jsonify({
        "processed": processed,
        "total_chunks": len(chunks_store),
        "sample_prompts": generate_sample_prompts(),
    })


# ── Chat (FIX #1: conversation memory) ───────────────────────────────────────
GREETING_PATTERNS = {
    "hi", "hello", "hey", "hola", "greetings", "good morning",
    "good afternoon", "good evening", "howdy", "sup", "yo", "hii",
    "hiii", "hiiii", "thanks", "thank you", "bye", "goodbye",
}


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json
    question = data.get("question", "").strip()
    history = data.get("history", [])  # FIX #1: frontend sends conversation history

    if not question:
        return jsonify({"error": "No question provided"}), 400

    q_lower = question.lower().strip("!?., ")
    if q_lower in GREETING_PATTERNS or len(q_lower) < 4:
        doc_count = len(doc_registry)
        if doc_count > 0:
            doc_names = ", ".join(d["name"] for d in doc_registry.values())
            return jsonify({"answer": f"Hello! I'm Dr.Doc. I have {doc_count} document(s) loaded: {doc_names}. Ask me anything about them!"})
        return jsonify({"answer": "Hello! I'm Dr.Doc by Deva Dharshan D. Upload documents in the Feed tab and I'll answer your questions!"})

    if not chunks_store or index is None:
        return jsonify({"answer": "No documents loaded yet. Upload some in the Feed tab first!"})

    try:
        q_emb = normalize_embeddings(get_embeddings([question]))

        k = min(8, len(chunks_store))
        scores, indices = index.search(q_emb, k)

        relevant = []
        for idx in indices[0]:
            if idx < 0 or idx >= len(chunks_store):
                continue
            relevant.append(chunks_store[idx])

        all_doc_names = [d["name"] for d in doc_registry.values()]

        context = "\n\n---\n\n".join(
            f"[Source: {c['source']}]\n{c['text']}" for c in relevant
        )

        # Build messages with conversation history (FIX #1)
        messages = [
            {
                "role": "system",
                "content": (
                    "You are Dr.Doc, an intelligent document assistant by Deva Dharshan D. "
                    "RULES: "
                    "1. Use plain text only. No markdown (**, ##, -, bullets). Use numbered lists and line breaks. "
                    f"2. Documents in knowledge base: {', '.join(all_doc_names)}. Reference ALL relevant ones. "
                    "3. Cite which document each point comes from. "
                    "4. If context is insufficient, say so honestly. "
                    "5. Be concise, friendly, thorough."
                ),
            }
        ]

        # Add last 6 messages of conversation history for memory
        for h in history[-6:]:
            role = h.get("role", "user")
            if role in ("user", "assistant"):
                messages.append({"role": role, "content": h.get("text", "")})

        # Add current question with context
        messages.append({
            "role": "user",
            "content": f"Document context:\n\n{context}\n\nQuestion: {question}",
        })

        response = client.chat.completions.create(
            model=CHAT_MODEL, messages=messages, temperature=0.3, max_tokens=1024
        )

        return jsonify({"answer": response.choices[0].message.content})

    except Exception as e:
        error_msg = str(e)
        print(f"[CHAT ERROR] {e}")
        if "401" in error_msg or "AuthenticationError" in type(e).__name__:
            return jsonify({"answer": "API authentication failed. Check your .env API key and endpoint."})
        if "ConnectError" in type(e).__name__ or "getaddrinfo" in error_msg:
            return jsonify({"answer": "Can't reach the AI service. Check your internet and OPENAI_BASE_URL."})
        return jsonify({"answer": f"Error: {error_msg}"})


@app.route("/api/prompts", methods=["GET"])
def get_prompts():
    return jsonify({"prompts": generate_sample_prompts()})


@app.route("/api/documents", methods=["GET"])
def get_documents():
    docs = [{"name": d["name"], "hash": h, "keywords": d["keywords"][:5]} for h, d in doc_registry.items()]
    return jsonify({"documents": docs, "total_chunks": len(chunks_store)})


# FIX #2: Delete without re-embedding — rebuild index from stored embeddings
@app.route("/api/documents/<doc_hash>", methods=["DELETE"])
def delete_document(doc_hash):
    global chunks_store, index, embeddings_store

    if doc_hash not in doc_registry:
        return jsonify({"error": "Document not found"}), 404

    doc_name = doc_registry[doc_hash]["name"]
    del doc_registry[doc_hash]

    # Find indices to KEEP
    keep_mask = [c["source"] != doc_name for c in chunks_store]
    remaining_chunks = [c for c, keep in zip(chunks_store, keep_mask) if keep]

    if remaining_chunks and embeddings_store is not None:
        keep_indices = [i for i, keep in enumerate(keep_mask) if keep]
        remaining_embs = embeddings_store[keep_indices]
        index = faiss.IndexFlatIP(remaining_embs.shape[1])
        index.add(remaining_embs)
        embeddings_store = remaining_embs
        for i, c in enumerate(remaining_chunks):
            c["id"] = i
    else:
        index = None
        embeddings_store = None

    chunks_store = remaining_chunks
    _save_state()

    file_path = UPLOAD_DIR / doc_name
    if file_path.exists():
        file_path.unlink()

    return jsonify({
        "status": "deleted", "name": doc_name,
        "total_chunks": len(chunks_store),
        "sample_prompts": generate_sample_prompts(),
    })


@app.route("/api/clear", methods=["POST"])
def clear_all():
    global chunks_store, index, doc_registry, embeddings_store
    chunks_store = []
    index = None
    doc_registry = {}
    embeddings_store = None
    _save_state()
    for f in UPLOAD_DIR.iterdir():
        f.unlink()
    return jsonify({"status": "cleared"})


@app.route("/api/test-connection", methods=["GET"])
def test_connection():
    try:
        resp = client.embeddings.create(input=["hello"], model=EMBED_MODEL)
        return jsonify({
            "status": "ok", "model": EMBED_MODEL,
            "dimension": len(resp.data[0].embedding),
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e), "type": type(e).__name__}), 500


# ── Audio transcription ───────────────────────────────────────────────────────
@app.route("/api/transcribe", methods=["POST"])
def transcribe_audio():
    if not audio_client:
        return jsonify({"error": "Audio service not configured. Check AZURE_AUDIO_* in .env"}), 500

    audio_file = request.files.get("audio")
    if not audio_file:
        return jsonify({"error": "No audio file provided"}), 400

    try:
        # Save temporarily
        tmp_path = UPLOAD_DIR / "temp_audio.webm"
        audio_file.save(str(tmp_path))

        with open(str(tmp_path), "rb") as f:
            transcript = audio_client.audio.transcriptions.create(
                model="whisper",
                file=f,
                response_format="text",
            )

        tmp_path.unlink(missing_ok=True)
        text = transcript if isinstance(transcript, str) else transcript.text
        return jsonify({"text": text.strip()})

    except Exception as e:
        print(f"[TRANSCRIBE ERROR] {e}")
        return jsonify({"error": f"Transcription failed: {str(e)}"}), 500


# ── Image chat (vision) ──────────────────────────────────────────────────────
@app.route("/api/chat-image", methods=["POST"])
def chat_image():
    if not vision_client:
        return jsonify({"answer": "Vision service not configured. Check AZURE_VISION_* in .env"})

    question = request.form.get("question", "").strip()
    image_file = request.files.get("image")

    if not image_file:
        return jsonify({"answer": "No image provided."}), 400
    if not question:
        question = "Describe this image in detail and explain what you see."

    try:
        image_data = image_file.read()
        b64_image = base64.b64encode(image_data).decode("utf-8")

        ext = image_file.filename.rsplit(".", 1)[-1].lower() if image_file.filename else "png"
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "gif": "image/gif", "webp": "image/webp"}.get(ext, "image/png")

        messages = [
            {
                "role": "system",
                "content": (
                    "You are Dr.Doc, an intelligent document assistant by Deva Dharshan D. "
                    "The user has uploaded an image and is asking about it. "
                    "Analyze the image carefully and answer the question. "
                    "Use plain text only, no markdown. Be thorough and helpful."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": question},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64_image}"},
                    },
                ],
            },
        ]

        response = vision_client.chat.completions.create(
            model=VISION_MODEL, messages=messages, temperature=0.3, max_tokens=1024
        )

        return jsonify({"answer": response.choices[0].message.content})

    except Exception as e:
        error_msg = str(e)
        print(f"[VISION ERROR] {e}")
        if "401" in error_msg:
            return jsonify({"answer": "Vision API authentication failed. Check AZURE_VISION_API_KEY."})
        return jsonify({"answer": f"Image analysis failed: {error_msg}"})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
