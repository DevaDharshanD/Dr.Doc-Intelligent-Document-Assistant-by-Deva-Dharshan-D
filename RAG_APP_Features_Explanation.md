# Dr.Doc — Intelligent Document Assistant

**By Deva Dharshan D (931033)**

Dr.Doc is a RAG (Retrieval-Augmented Generation) chatbot that lets you upload documents, ask questions about them, and get accurate answers grounded in your content.

---

## Core Functionalities

### 1. Document Ingestion (Feed Tab)

- Upload PDF, DOCX, and TXT files via drag-and-drop or file browser
- Upload multiple files at once
- Paste raw text directly as an alternative to file upload
- Automatic text extraction from PDFs (including multi-page) and Word documents (paragraphs and tables)
- Real-time token-based chunking using tiktoken (400 tokens per chunk, 50-token overlap)
- Embedding generation via Azure OpenAI text-embedding-3-large
- Vector storage using FAISS (Facebook AI Similarity Search) with cosine similarity
- Duplicate detection using SHA-256 hashing with whitespace normalization
- Per-document management: view, delete individual documents, or clear all

### 2. Intelligent Chat (Chat Tab)

- Ask natural language questions about uploaded documents
- Retrieves top 8 most relevant chunks across all documents using vector similarity search
- Answers grounded in document context with source citations
- Conversation memory: sends last 6 messages to the LLM so follow-up questions work naturally
- Handles greetings and casual messages without requiring documents
- Friendly error messages displayed in the chat when API issues occur
- Plain text responses (no markdown formatting)

### 3. Multi-Document Intelligence

- Cross-document comparison and analysis
- References all relevant documents when answering
- Dynamic sample prompts that update based on document content and keywords
- Sample prompts are clickable and paste into the input field

### 4. Voice Input (Speech-to-Text)

- Microphone button for hands-free input
- Primary: Browser Web Speech API (Chrome/Edge) for instant, free transcription
- Fallback: Azure Whisper model for Firefox/Safari — records audio, sends to server for transcription
- Visual recording indicator (pulsing red) while listening
- Transcribed text is appended to the input field for review before sending

### 5. Image Q&A (Vision)

- Upload an image (JPG, PNG, GIF, WebP) directly in the chat
- Ask questions about the image content
- Image preview shown above input before sending and inline in the chat thread
- Powered by Azure OpenAI GPT-4 Vision
- Images are analyzed in real-time and not stored in the RAG knowledge base

### 6. Text-to-Speech (Voice Output)

- Speaker button on every assistant message to read the response aloud
- Click again to stop playback
- Settings panel with configurable options:
  - Voice selection from all system-available voices
  - Speed control (0.5x to 2.0x)
  - Pitch control (0.5 to 2.0)
  - Auto-speak toggle to automatically read every new response
- Live preview audio plays when changing any voice setting
- All voice preferences saved to browser localStorage

### 7. Chat History Management

- Multiple chat sessions stored in browser localStorage
- New Chat button to start fresh conversations
- Auto-titled based on the first question asked
- Rename any chat session
- Delete individual chat sessions
- Switch between chat sessions seamlessly
- Capped at 30 chats with automatic pruning of old messages

### 8. Message Actions

- Copy: Copy any message text to clipboard (visual confirmation)
- Edit: Paste a user message back into the input for modification
- Re-ask: Resend the original question to get a fresh response

### 9. Knowledge Base Sidebar

- Live document list with file-type icons (PDF red, DOCX blue, TXT green)
- Chunk count per document
- Individual document deletion with embedding cleanup (no re-embedding needed)
- Clear All to reset the entire knowledge base

### 10. Error Handling

- All API errors caught and displayed as friendly chat messages
- Authentication errors, connection failures, and server errors identified separately
- Global JSON error handler prevents HTML error pages
- Upload errors shown per-file with specific failure reasons

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python, Flask |
| LLM | Azure OpenAI GPT-4.1-mini |
| Embeddings | Azure OpenAI text-embedding-3-large |
| Vector DB | FAISS (IndexFlatIP, cosine similarity) |
| Tokenizer | tiktoken (cl100k_base) |
| Speech-to-Text | Browser Web Speech API + Azure Whisper |
| Vision | Azure OpenAI GPT-4 Vision |
| Text-to-Speech | Browser SpeechSynthesis API |
| Frontend | HTML, CSS, JavaScript (vanilla) |
| Icons | Bootstrap Icons |
| Storage | localStorage (chat history), filesystem (documents, vectors) |
