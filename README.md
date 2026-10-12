# Dr.Doc — Intelligent Document Assistant by Deva Dharshan D

Dr.Doc is a multimodal Retrieval-Augmented Generation (RAG) application that lets users upload documents, ask natural-language questions with conversation memory, use voice input/output, and analyze images — all grounded in a vector knowledge base built from your uploaded content.

![Python](https://img.shields.io/badge/Python-3.12-blue)
![Flask](https://img.shields.io/badge/Flask-3.1-green)
![Azure OpenAI](https://img.shields.io/badge/Azure%20OpenAI-gpt--4.1--mini-orange)
![FAISS](https://img.shields.io/badge/FAISS-1.9-purple)
![Whisper](https://img.shields.io/badge/Azure%20Whisper-Speech--to--Text-red)

---

## Table of Contents

- [How It Works](#how-it-works)
- [Features](#features)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Usage Guide](#usage-guide)
- [Architecture Details](#architecture-details)
- [Limitations](#limitations)
- [License](#license)

---

## How It Works

```
                        ┌─────────────────────────────────────────────┐
                        │              MULTIMODAL INPUT               │
                        │  Text / Voice (Whisper) / Image (GPT-4V)    │
                        └────────────────────┬────────────────────────┘
                                             │
              ┌──────────────────────────────┼──────────────────────────────┐
              ▼                              ▼                              ▼
   ┌────────────────┐           ┌────────────────────┐          ┌───────────────────┐
   │  DOCUMENT FEED │           │    TEXT CHAT (RAG) │          │   IMAGE CHAT      │
   │  PDF/DOCX/TXT  │           │  Question + History│          │  Vision API       │
   │  + Paste Text  │           │  + Top-8 Retrieval │          │  GPT-4.1-mini     │
   └───────┬────────┘           └─────────┬──────────┘          └───────────────────┘
           │                              │
           ▼                              ▼
   ┌────────────────┐           ┌────────────────────┐
   │ Extract → Chunk│           │  FAISS Cosine      │
   │ → Embed (3072d)│           │  Similarity Search │
   │ → FAISS Index  │           │  → LLM w/ Context  │
   └────────────────┘           └─────────┬──────────┘
                                          │
                                          ▼
                               ┌────────────────────┐
                               │  Answer + Sources  │
                               │  + Voice (TTS)     │
                               └────────────────────┘
```

1. **Ingest** — Upload PDF, DOCX, or TXT files (or paste raw text) via the Feed tab.
2. **Chunk** — Text is extracted (including DOCX table content) and split into 400-token windows with 50-token overlap using tiktoken.
3. **Embed** — Each chunk is embedded via Azure OpenAI `text-embedding-3-large` (3072 dimensions), L2-normalized, and indexed in FAISS.
4. **Ask** — Type a question, use voice input, or upload an image. The top-8 most similar chunks are retrieved and sent with up to 6 messages of conversation history to `gpt-4.1-mini`.
5. **Answer** — Dr.Doc responds with a grounded answer. Optionally read aloud via browser Text-to-Speech with configurable voice, speed, and pitch.

---

## Features

### Multimodal Input
- **Text chat** — Type questions in a conversational interface with full keyboard shortcuts (Enter to send, Shift+Enter for new line).
- **Voice input (Speech-to-Text)** — Click the microphone button to dictate questions. Uses browser SpeechRecognition API when available; falls back to Azure Whisper transcription for unsupported browsers.
- **Image Q&A (Vision)** — Upload an image directly in the chat input. Dr.Doc analyzes it using GPT-4.1-mini's vision capability and answers questions about diagrams, charts, screenshots, or any visual content.
- **Image preview bar** — Selected images show a thumbnail preview with filename before sending; easily removable.

### Text-to-Speech Output
- **Read aloud button** — Every assistant response has a speaker icon to read the answer aloud using the browser's SpeechSynthesis API.
- **Auto-speak mode** — Toggle in Settings to automatically read every new assistant response aloud.
- **Voice settings modal** — Configure voice (from all system-installed voices), speech rate (0.5x–2x), and pitch (0.5–2.0). Settings persist in localStorage.
- **Live preview** — Changing any voice setting triggers an instant spoken preview.

### Conversation Memory & Chat History
- **Conversation context** — Each chat request includes the last 6 messages of history, enabling follow-up questions and multi-turn conversations.
- **Persistent chat history** — Up to 30 chat sessions are stored in localStorage with auto-generated titles based on the first question.
- **Chat management** — Rename chats, delete individual chats, or start a new chat from the sidebar.
- **Automatic pruning** — Older chats are trimmed to keep localStorage usage manageable.

### Document Ingestion
- **Multi-format support** — Upload PDF, DOCX, DOC, and TXT files.
- **Enhanced DOCX extraction** — Extracts both paragraphs and table content (pipe-delimited rows) from Word documents.
- **Drag-and-drop upload** — Drop files directly onto the upload zone.
- **Multi-file upload** — Queue multiple files with size display and individual remove buttons.
- **Paste raw text** — Paste text directly into the knowledge base; sequential pastes are uniquely named (Pasted Text #1, #2, etc.).
- **SHA-256 deduplication** — Whitespace-normalized content hashing prevents duplicate documents.
- **Token-based chunking** — Uses tiktoken (GPT-4 tokenizer) for accurate 400-token chunks with 50-token overlap, instead of word-based splitting.
- **Auto-detect embedding dimension** — Embedding dimension is detected from the first API response rather than hardcoded.
- **Upload progress bar** — Visual progress with animated gradient during embedding generation.
- **Error recovery** — If embedding fails mid-upload, already-registered documents are rolled back and the error is surfaced per-file.

### Knowledge Base Management
- **Individual document deletion** — Remove specific documents from the sidebar without re-embedding; the FAISS index is rebuilt from stored raw embeddings.
- **Sidebar document list** — Live inventory with Bootstrap Icons for each file type (PDF, DOCX, TXT).
- **Document stats** — Displays total document and chunk counts.
- **Clear all** — Wipe all documents, embeddings, uploaded files, and chat history.
- **Persistent storage** — FAISS index, raw embeddings (`.npy`), and chunk metadata survive server restarts.

### Message Actions
- **Copy** — Copy any message text to clipboard (with checkmark confirmation).
- **Edit & resend** — Edit a previous user message and resubmit it.
- **Re-ask** — Regenerate an assistant response by re-sending the preceding question.
- **Read aloud** — Play/stop text-to-speech on any assistant message.

### Smart Chat Behavior
- **Greeting detection** — Recognizes greetings (hi, hello, hey, thanks, etc.) and responds conversationally without consuming API tokens for retrieval.
- **Connection test endpoint** — `/api/test-connection` verifies Azure OpenAI connectivity and reports the embedding dimension.
- **Detailed error handling** — Authentication errors, network failures, and API issues produce specific, actionable error messages.
- **XSS protection** — All user-generated strings are HTML-escaped before DOM insertion.

### User Interface
- **Tata Technologies branding** — Logo, "Dr.Doc" name, and "by Deva Dharshan D" subtitle throughout.
- **Bootstrap Icons** — Full icon set for consistent, professional iconography.
- **Two-tab layout** — Chat tab for Q&A, Feed tab for document ingestion.
- **Welcome screen** — Feature cards showcasing all 6 capabilities (PDF, Word, Text, Paste, Voice, Image).
- **Dynamic sample prompts** — Context-aware quick actions regenerated after each upload.
- **Responsive design** — Sidebar collapses to icon-only mode on screens under 768px.
- **Polished CSS** — 1295 lines of custom styling with CSS variables, gradients, animations, and Inter + JetBrains Mono fonts.

---

## Project Structure

```
rag_app/
├── app.py                      # Flask backend — API routes, RAG pipeline, vision, audio
├── requirements.txt            # Python dependencies
├── .env                        # Azure OpenAI credentials (DO NOT COMMIT)
├── templates/
│   └── index.html              # Jinja2 HTML (sidebar, chat, feed, voice settings modal)
├── static/
│   ├── css/
│   │   └── style.css           # Custom CSS (~1295 lines)
│   ├── js/
│   │   └── app.js              # Frontend SPA logic (~676 lines)
│   └── images/
│       └── tata.png            # Tata Technologies logo
├── uploads/                    # Saved uploaded files (created at runtime)
└── vector_store/               # Persisted knowledge base (created at runtime)
    ├── index.faiss             # FAISS vector index
    ├── embeddings.npy          # Raw embedding matrix (for deletion/rebuild)
    └── meta.pkl                # Chunk text + document registry
```

---

## Tech Stack

| Layer | Technology | Details |
|---|---|---|
| **Backend** | Flask 3.1 | REST API + static frontend serving |
| **LLM (Chat)** | Azure OpenAI `gpt-4.1-mini` | Chat completions with conversation history (temp 0.3) |
| **LLM (Vision)** | Azure OpenAI `gpt-4.1-mini` | Multimodal vision — image + text input |
| **Embeddings** | Azure OpenAI `text-embedding-3-large` | 3072-dim vectors, batched 16 at a time |
| **Speech-to-Text** | Browser SpeechRecognition + Azure Whisper | Dual-path: browser API primary, Whisper fallback |
| **Text-to-Speech** | Browser SpeechSynthesis API | Configurable voice, rate, pitch; auto-speak mode |
| **Vector Store** | FAISS 1.9 (`IndexFlatIP`) | Cosine similarity via L2-normalized inner product |
| **Tokenizer** | tiktoken (cl100k_base) | Accurate token counting for chunk boundaries |
| **PDF Parsing** | PyPDF2 3.0.1 | Page-by-page text extraction |
| **DOCX Parsing** | python-docx 1.1.2 | Paragraph + table extraction (XML-level) |
| **Frontend** | Vanilla JS + Bootstrap Icons + Custom CSS | SPA with localStorage persistence |

---

## Prerequisites

- Python 3.10+
- Azure OpenAI resource with deployed models:
  - `gpt-4.1-mini` (chat + vision)
  - `text-embedding-3-large` (embeddings)
  - `whisper` (audio transcription — optional)

---

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/<your-org>/dr-doc.git
   cd dr-doc
   ```

2. **Create a virtual environment**

   ```bash
   python -m venv venv
   source venv/bin/activate   # Windows: venv\Scripts\activate
   ```

3. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables** (see [Configuration](#configuration))

5. **Run the application**

   ```bash
   python app.py
   ```

   The app starts at `http://localhost:5000`.

---

## Configuration

Create a `.env` file in the project root:

```env
# Chat + Embeddings
OPENAI_BASE_URL=https://<your-resource>.services.ai.azure.com
OPENAI_API_KEY=<your-api-key>
OPENAI_API_VERSION=2024-12-01-preview
MODEL_DEPLOYMENT_NAME=gpt-4.1-mini
AZURE_EMBED_MODEL=text-embedding-3-large

# Audio / Whisper (optional — voice input fallback)
AZURE_AUDIO_API_KEY=<your-audio-key>
AZURE_AUDIO_ENDPOINT=https://<your-resource>.openai.azure.com/

# Vision / Image Q&A (optional)
AZURE_VISION_API_KEY=<your-vision-key>
AZURE_VISION_ENDPOINT=https://<your-resource>.openai.azure.com/
```

| Variable | Required | Description |
|---|---|---|
| `OPENAI_BASE_URL` | Yes | Azure OpenAI base endpoint |
| `OPENAI_API_KEY` | Yes | Azure OpenAI API key |
| `OPENAI_API_VERSION` | Yes | API version |
| `MODEL_DEPLOYMENT_NAME` | Yes | Chat model deployment name |
| `AZURE_EMBED_MODEL` | Yes | Embedding model deployment name |
| `AZURE_AUDIO_API_KEY` | No | Whisper transcription API key |
| `AZURE_AUDIO_ENDPOINT` | No | Whisper endpoint |
| `AZURE_VISION_API_KEY` | No | Vision/image analysis API key |
| `AZURE_VISION_ENDPOINT` | No | Vision endpoint |

> **Important:** Add `.env` to `.gitignore` before pushing to GitHub.

---

## API Reference

| Route | Method | Description |
|---|---|---|
| `/` | GET | Serve the web UI |
| `/api/upload` | POST | Upload files / paste text → extract → chunk → embed → index |
| `/api/chat` | POST | Send `{ question, history }` → retrieve → generate answer |
| `/api/chat-image` | POST | Send image + question → vision analysis → answer |
| `/api/transcribe` | POST | Send audio blob → Azure Whisper → transcribed text |
| `/api/prompts` | GET | Get dynamic sample prompts based on knowledge base |
| `/api/documents` | GET | List indexed documents with hashes and keywords |
| `/api/documents/<hash>` | DELETE | Remove a specific document and rebuild the index |
| `/api/clear` | POST | Wipe all documents, embeddings, and uploaded files |
| `/api/test-connection` | GET | Verify Azure OpenAI connectivity and embedding dimension |

---

## Usage Guide

### Uploading Documents (Feed Tab)
1. Switch to the **Feed** tab in the sidebar.
2. Drag-and-drop files or click to browse. Paste text in the text area below.
3. Review the file queue, then click **Process & Generate Embeddings**.
4. Watch progress and review per-file results.

### Asking Questions (Chat Tab)
- **Text:** Type in the input box, press Enter.
- **Voice:** Click the microphone icon, speak, and your words appear in the input.
- **Image:** Click the image icon, select a file, optionally type a question, then send.

### Voice Settings
- Click **Settings** in the sidebar footer.
- Choose a voice, adjust speed and pitch. Changes are previewed instantly and saved.
- Toggle **Auto-speak replies** to hear every response automatically.

### Managing the Knowledge Base
- **Delete one document:** Click the X on any document in the sidebar list.
- **Clear all:** Click **Clear All** in the sidebar footer.
- **Chat history:** Click **New Chat** for a fresh conversation. Rename or delete past chats from the sidebar.

---

## Architecture Details

### Token-Based Chunking
- Uses `tiktoken` with the `cl100k_base` encoding (GPT-4 tokenizer).
- **Chunk size:** 400 tokens with 50-token overlap.
- Ensures chunks respect token boundaries for optimal retrieval.

### Embedding & Retrieval
- Embeddings are generated in batches of 16 and L2-normalized for cosine similarity.
- Top-8 chunks are retrieved per query (up from 5 in v1).
- Raw embeddings are stored separately in `embeddings.npy` to enable document deletion without re-embedding.

### Conversation Memory
- The frontend sends the last 6 messages (3 turns) of conversation history with each request.
- The LLM receives system prompt + history + current question with context, enabling follow-up questions.

### Document Deletion
- When a document is deleted, its chunks and corresponding embedding rows are identified by source name.
- The FAISS index is rebuilt from the remaining rows of the stored embedding matrix — no API calls needed.

### Vision Pipeline
- Images are base64-encoded client-side and sent as `multipart/form-data`.
- The backend constructs a multimodal message with `image_url` (data URI) + text, sent to the vision-capable model.

### Audio Pipeline
- Primary: Browser's Web Speech API (`SpeechRecognition`) — instant, no server round-trip.
- Fallback: Audio recorded as WebM via `MediaRecorder`, sent to `/api/transcribe`, transcribed by Azure Whisper.

---

## Limitations

- **Single-server only** — In-memory state and pickle/numpy persistence are not suitable for multi-process deployments.
- **No authentication** — No user login or access control.
- **No streaming** — Responses are returned in full (no token-by-token streaming).
- **localStorage limits** — Chat history is capped at 30 sessions with automatic pruning.
- **Voice input** — Browser SpeechRecognition requires HTTPS in most browsers (except localhost).

---

## License

Internal use — By Deva Dharshan D.
