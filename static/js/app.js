document.addEventListener("DOMContentLoaded", () => {
    const tabChat = document.getElementById("tab-chat");
    const tabFeed = document.getElementById("tab-feed");
    const sectionChat = document.getElementById("section-chat");
    const sectionFeed = document.getElementById("section-feed");
    const chatMessages = document.getElementById("chat-messages");
    const chatInput = document.getElementById("chat-input");
    const sendBtn = document.getElementById("send-btn");
    const welcomeScreen = document.getElementById("welcome-screen");
    const promptsGrid = document.getElementById("prompts-grid");
    const uploadZone = document.getElementById("upload-zone");
    const fileInput = document.getElementById("file-input");
    const fileQueue = document.getElementById("file-queue");
    const queueList = document.getElementById("queue-list");
    const queueClear = document.getElementById("queue-clear");
    const pasteText = document.getElementById("paste-text");
    const uploadBtn = document.getElementById("upload-btn");
    const uploadProgress = document.getElementById("upload-progress");
    const progressFill = document.getElementById("progress-fill");
    const progressText = document.getElementById("progress-text");
    const uploadResults = document.getElementById("upload-results");
    const docList = document.getElementById("doc-list");
    const docStats = document.getElementById("doc-stats");
    const clearAllBtn = document.getElementById("clear-all-btn");
    const chatHistoryList = document.getElementById("chat-history-list");
    const newChatBtn = document.getElementById("new-chat-btn");
    const micBtn = document.getElementById("mic-btn");
    const imageBtn = document.getElementById("image-btn");
    const imageInput = document.getElementById("image-input");
    const imagePreviewBar = document.getElementById("image-preview-bar");
    const imagePreviewThumb = document.getElementById("image-preview-thumb");
    const imagePreviewName = document.getElementById("image-preview-name");
    const imagePreviewRemove = document.getElementById("image-preview-remove");

    let selectedFiles = [];
    let selectedImage = null; // for chat image Q&A
    let isRecording = false;
    let mediaRecorder = null;
    const MAX_CHATS = 30; // FIX #9: cap chat history

    const FILE_ICONS = {
        pdf: '<i class="bi bi-file-earmark-pdf-fill text-danger"></i>',
        docx: '<i class="bi bi-file-earmark-word-fill text-primary"></i>',
        doc: '<i class="bi bi-file-earmark-word-fill text-primary"></i>',
        txt: '<i class="bi bi-file-earmark-text-fill text-success"></i>',
        text: '<i class="bi bi-file-earmark-richtext-fill text-warning"></i>',
    };

    // FIX #15: sanitize strings before inserting into HTML
    function esc(str) {
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }

    // ── Chat History State ─────────────────────────────────────────
    let chats = JSON.parse(localStorage.getItem("drdoc_chats") || "[]");
    let activeChatId = localStorage.getItem("drdoc_active_chat") || null;

    function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    function saveChats() {
        // FIX #9: prune oldest chats if over limit
        if (chats.length > MAX_CHATS) {
            chats = chats.slice(0, MAX_CHATS);
        }
        // FIX #9: prune messages in old chats to keep localStorage small
        chats.forEach((c, i) => {
            if (i > 10 && c.messages.length > 20) {
                c.messages = c.messages.slice(-20);
            }
        });
        try {
            localStorage.setItem("drdoc_chats", JSON.stringify(chats));
            localStorage.setItem("drdoc_active_chat", activeChatId || "");
        } catch (e) {
            // localStorage full — drop oldest chats
            chats = chats.slice(0, 10);
            localStorage.setItem("drdoc_chats", JSON.stringify(chats));
        }
    }

    function getActiveChat() { return chats.find(c => c.id === activeChatId); }

    function createNewChat() {
        const chat = { id: genId(), title: "New Chat", messages: [], created: Date.now() };
        chats.unshift(chat);
        activeChatId = chat.id;
        saveChats();
        renderChatHistory();
        renderActiveChat();
    }

    function renderChatHistory() {
        if (!chatHistoryList) return;
        chatHistoryList.innerHTML = "";
        chats.forEach(c => {
            const item = document.createElement("div");
            item.className = "chat-history-item" + (c.id === activeChatId ? " active" : "");
            item.dataset.id = c.id;
            item.innerHTML = `
                <i class="bi bi-chat-left-text"></i>
                <span class="chat-title" title="${esc(c.title)}">${esc(c.title)}</span>
                <div class="chat-actions">
                    <button class="chat-rename-btn" title="Rename"><i class="bi bi-pencil"></i></button>
                    <button class="chat-delete-btn" title="Delete"><i class="bi bi-trash3"></i></button>
                </div>
            `;
            chatHistoryList.appendChild(item);
        });
    }

    function renderActiveChat() {
        const chat = getActiveChat();
        chatMessages.innerHTML = "";
        if (!chat || chat.messages.length === 0) {
            chatMessages.appendChild(welcomeScreen);
            welcomeScreen.style.display = "flex";
            return;
        }
        welcomeScreen.style.display = "none";
        chat.messages.forEach((m, i) => appendMessageDOM(m.role, m.text, i));
        requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; });
    }

    function autoTitle(chat) {
        if (chat.title !== "New Chat") return;
        const firstQ = chat.messages.find(m => m.role === "user");
        if (firstQ) {
            chat.title = firstQ.text.slice(0, 40) + (firstQ.text.length > 40 ? "..." : "");
            saveChats();
            renderChatHistory();
        }
    }

    if (chatHistoryList) {
        chatHistoryList.addEventListener("click", (e) => {
            const renameBtn = e.target.closest(".chat-rename-btn");
            const deleteBtn = e.target.closest(".chat-delete-btn");
            const item = e.target.closest(".chat-history-item");
            if (!item) return;
            const id = item.dataset.id;
            if (renameBtn) {
                const chat = chats.find(c => c.id === id);
                if (!chat) return;
                const newName = prompt("Rename chat:", chat.title);
                if (newName && newName.trim()) { chat.title = newName.trim(); saveChats(); renderChatHistory(); }
                return;
            }
            if (deleteBtn) {
                if (!confirm("Delete this chat?")) return;
                chats = chats.filter(c => c.id !== id);
                if (activeChatId === id) { activeChatId = chats.length > 0 ? chats[0].id : null; if (!activeChatId) createNewChat(); }
                saveChats(); renderChatHistory(); renderActiveChat();
                return;
            }
            activeChatId = id; saveChats(); renderChatHistory(); renderActiveChat();
        });
    }

    if (newChatBtn) newChatBtn.addEventListener("click", () => createNewChat());

    // ── Tab Switching ─────────────────────────────────────────────
    function switchTab(tab) {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".section-panel").forEach(s => s.classList.remove("active"));
        if (tab === "chat") { tabChat.classList.add("active"); sectionChat.classList.add("active"); }
        else {
            tabFeed.classList.add("active"); sectionFeed.classList.add("active");
            uploadProgress.style.display = "none"; uploadResults.style.display = "none";
            progressFill.style.width = "0%"; progressFill.style.background = "linear-gradient(90deg, #6366f1, #a855f7)";
        }
    }

    tabChat.addEventListener("click", () => switchTab("chat"));
    tabFeed.addEventListener("click", () => switchTab("feed"));

    // ── Chat Input ────────────────────────────────────────────────
    chatInput.addEventListener("input", () => {
        chatInput.style.height = "auto";
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
        sendBtn.disabled = !chatInput.value.trim() && !selectedImage;
    });

    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (chatInput.value.trim() || selectedImage) sendMessage(); }
    });

    sendBtn.addEventListener("click", () => { if (chatInput.value.trim() || selectedImage) sendMessage(); });

    // ── Microphone (voice input) ──────────────────────────────────
    if (micBtn) {
        micBtn.addEventListener("click", async () => {
            if (isRecording) {
                // Stop recording
                if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
                return;
            }

            // Try browser SpeechRecognition first (instant, free)
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.lang = "en-US";
                recognition.interimResults = false;
                recognition.maxAlternatives = 1;

                micBtn.classList.add("recording");
                micBtn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
                isRecording = true;

                recognition.onresult = (event) => {
                    const text = event.results[0][0].transcript;
                    chatInput.value += (chatInput.value ? " " : "") + text;
                    chatInput.dispatchEvent(new Event("input"));
                };
                recognition.onerror = () => {};
                recognition.onend = () => {
                    micBtn.classList.remove("recording");
                    micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
                    isRecording = false;
                };
                recognition.start();
                return;
            }

            // Fallback: record audio and send to Azure Whisper
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const chunks = [];
                mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

                micBtn.classList.add("recording");
                micBtn.innerHTML = '<i class="bi bi-stop-circle-fill"></i>';
                isRecording = true;

                mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

                mediaRecorder.onstop = async () => {
                    micBtn.classList.remove("recording");
                    micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
                    isRecording = false;
                    stream.getTracks().forEach(t => t.stop());

                    const blob = new Blob(chunks, { type: "audio/webm" });
                    const formData = new FormData();
                    formData.append("audio", blob, "recording.webm");

                    micBtn.disabled = true;
                    micBtn.innerHTML = '<div class="spinner-small"></div>';

                    try {
                        const resp = await fetch("/api/transcribe", { method: "POST", body: formData });
                        const data = await resp.json();
                        if (data.text) {
                            chatInput.value += (chatInput.value ? " " : "") + data.text;
                            chatInput.dispatchEvent(new Event("input"));
                        } else if (data.error) {
                            alert("Transcription error: " + data.error);
                        }
                    } catch (err) {
                        alert("Could not transcribe audio.");
                    }
                    micBtn.disabled = false;
                    micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
                };

                mediaRecorder.start();
            } catch (err) {
                alert("Microphone access denied.");
            }
        });
    }

    // ── Image upload for chat Q&A ─────────────────────────────────
    if (imageBtn) imageBtn.addEventListener("click", () => imageInput.click());

    if (imageInput) {
        imageInput.addEventListener("change", () => {
            const file = imageInput.files[0];
            if (!file) return;
            selectedImage = file;
            const url = URL.createObjectURL(file);
            imagePreviewThumb.src = url;
            imagePreviewName.textContent = file.name;
            imagePreviewBar.style.display = "flex";
            sendBtn.disabled = false;
            imageInput.value = "";
        });
    }

    if (imagePreviewRemove) {
        imagePreviewRemove.addEventListener("click", () => {
            selectedImage = null;
            imagePreviewBar.style.display = "none";
            imagePreviewThumb.src = "";
            sendBtn.disabled = !chatInput.value.trim();
        });
    }

    // ── Send Message (with image support + conversation history) ──
    async function sendMessage(overrideQuestion) {
        const question = overrideQuestion || chatInput.value.trim();
        const hasImage = selectedImage && !overrideQuestion;

        if (!question && !hasImage) return;

        let chat = getActiveChat();
        if (!chat) { createNewChat(); chat = getActiveChat(); }

        welcomeScreen.style.display = "none";

        // Show user message (clean text, no filename tag)
        const userText = question || (hasImage ? "Analyze this image" : "");
        chat.messages.push({ role: "user", text: userText, hasImage: hasImage });
        appendMessageDOM("user", userText, chat.messages.length - 1, hasImage ? selectedImage : null);

        if (!overrideQuestion) { chatInput.value = ""; chatInput.style.height = "auto"; sendBtn.disabled = true; }
        autoTitle(chat);
        saveChats();

        const typingEl = showTypingIndicator();

        try {
            let data;

            if (hasImage) {
                // Send to vision endpoint
                const formData = new FormData();
                formData.append("image", selectedImage);
                formData.append("question", question || "Describe this image in detail.");

                const resp = await fetch("/api/chat-image", { method: "POST", body: formData });
                const ct = resp.headers.get("content-type") || "";
                if (ct.includes("application/json")) { data = await resp.json(); }
                else { data = { answer: `Server error (${resp.status}).` }; }

                // Clear image selection
                selectedImage = null;
                imagePreviewBar.style.display = "none";
                imagePreviewThumb.src = "";
            } else {
                // Regular text chat with history
                const history = chat.messages.slice(-7, -1).map(m => ({ role: m.role, text: m.text }));
                const resp = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ question, history }),
                });
                const ct = resp.headers.get("content-type") || "";
                if (ct.includes("application/json")) { data = await resp.json(); }
                else { data = { answer: `Server error (${resp.status}).` }; }
            }

            typingEl.remove();
            const answer = data.answer || data.error || "No response received.";
            chat.messages.push({ role: "assistant", text: answer });
            appendMessageDOM("assistant", answer, chat.messages.length - 1);
            saveChats();
            // Auto-speak if enabled
            if (autoSpeak && autoSpeak.checked) speakText(answer);
        } catch (err) {
            typingEl.remove();
            const errMsg = "Can't reach the server. Make sure the app is running.";
            chat.messages.push({ role: "assistant", text: errMsg });
            appendMessageDOM("assistant", errMsg, chat.messages.length - 1);
            saveChats();
        }
    }

    function appendMessageDOM(role, text, msgIndex, imageFile) {
        const div = document.createElement("div");
        div.className = `message ${role}`;
        div.dataset.msgIndex = msgIndex;

        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.innerHTML = role === "user"
            ? '<i class="bi bi-person-fill"></i>'
            : '<i class="bi bi-file-earmark-medical-fill"></i>';

        const content = document.createElement("div");
        content.className = "message-content";
        if (text) content.textContent = text;

        const wrapper = document.createElement("div");
        wrapper.className = "message-wrapper";

        // If image attached, show it inline below the text
        if (imageFile) {
            const imgWrap = document.createElement("div");
            imgWrap.className = "chat-image-preview";
            const img = document.createElement("img");
            img.src = URL.createObjectURL(imageFile);
            img.alt = "Uploaded image";
            imgWrap.appendChild(img);
            wrapper.appendChild(content);
            wrapper.appendChild(imgWrap);
        } else {
            wrapper.appendChild(content);
        }

        const actions = document.createElement("div");
        actions.className = "message-actions";
        if (role === "user") {
            actions.innerHTML = `
                <button class="msg-action-btn msg-edit" title="Edit & resend"><i class="bi bi-pencil-square"></i></button>
                <button class="msg-action-btn msg-copy" title="Copy"><i class="bi bi-clipboard"></i></button>`;
        } else {
            actions.innerHTML = `
                <button class="msg-action-btn msg-speak" title="Read aloud"><i class="bi bi-volume-up-fill"></i></button>
                <button class="msg-action-btn msg-copy" title="Copy"><i class="bi bi-clipboard"></i></button>
                <button class="msg-action-btn msg-reask" title="Re-ask"><i class="bi bi-arrow-repeat"></i></button>`;
        }
        wrapper.appendChild(actions);
        div.appendChild(avatar);
        div.appendChild(wrapper);
        chatMessages.appendChild(div);
        requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; });
    }

    function scrollChat() { requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }); }

    chatMessages.addEventListener("click", (e) => {
        const btn = e.target.closest(".msg-action-btn");
        if (!btn) return;
        const msgEl = btn.closest(".message");
        const msgIndex = parseInt(msgEl.dataset.msgIndex);
        const chat = getActiveChat();
        if (!chat) return;
        const msg = chat.messages[msgIndex];
        if (!msg) return;

        if (btn.classList.contains("msg-copy")) {
            navigator.clipboard.writeText(msg.text).then(() => {
                const icon = btn.querySelector("i");
                icon.className = "bi bi-check-lg";
                setTimeout(() => { icon.className = "bi bi-clipboard"; }, 1500);
            });
        }
        if (btn.classList.contains("msg-edit")) {
            chatInput.value = msg.text;
            chatInput.dispatchEvent(new Event("input"));
            chatInput.focus();
        }
        if (btn.classList.contains("msg-reask")) {
            let q = null;
            for (let i = msgIndex - 1; i >= 0; i--) { if (chat.messages[i].role === "user") { q = chat.messages[i].text; break; } }
            if (q) sendMessage(q);
        }
        if (btn.classList.contains("msg-speak")) {
            speakText(msg.text, btn);
        }
    });

    function showTypingIndicator() {
        const div = document.createElement("div");
        div.className = "typing-indicator";
        div.innerHTML = `<div class="message-avatar" style="background:linear-gradient(135deg,#6366f1,#a855f7);color:white;"><i class="bi bi-file-earmark-medical-fill"></i></div><div class="typing-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
        chatMessages.appendChild(div);
        requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; });
        return div;
    }

    // ── Sample Prompts ────────────────────────────────────────────
    promptsGrid.addEventListener("click", (e) => {
        const card = e.target.closest(".prompt-card");
        if (!card) return;
        const p = card.dataset.prompt;
        if (p.startsWith("Upload") || p.startsWith("I can") || p.startsWith("Try uploading")) { switchTab("feed"); return; }
        chatInput.value = p; chatInput.dispatchEvent(new Event("input")); chatInput.focus();
    });

    function updateSamplePrompts(prompts) {
        const icons = ["📊", "💡", "🔍", "📝", "🎯"];
        promptsGrid.innerHTML = "";
        prompts.forEach((p, i) => {
            const btn = document.createElement("button");
            btn.className = "prompt-card";
            btn.dataset.prompt = p;
            btn.innerHTML = `<div class="prompt-icon">${icons[i % icons.length]}</div><span>${esc(p)}</span>`;
            promptsGrid.appendChild(btn);
        });
    }

    // ── File Upload ───────────────────────────────────────────────
    uploadZone.addEventListener("click", () => fileInput.click());
    uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
    uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
    uploadZone.addEventListener("drop", (e) => { e.preventDefault(); uploadZone.classList.remove("dragover"); addFiles(e.dataTransfer.files); });
    fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

    function addFiles(files) {
        for (const f of files) {
            const ext = f.name.split(".").pop().toLowerCase();
            if (["pdf", "docx", "doc", "txt"].includes(ext)) {
                if (!selectedFiles.find(sf => sf.name === f.name && sf.size === f.size)) selectedFiles.push(f);
            }
        }
        renderQueue();
    }

    function renderQueue() {
        if (selectedFiles.length === 0) { fileQueue.style.display = "none"; checkUploadBtn(); return; }
        fileQueue.style.display = "block"; queueList.innerHTML = "";
        selectedFiles.forEach((f, i) => {
            const ext = f.name.split(".").pop().toLowerCase();
            const size = f.size < 1024 * 1024 ? (f.size / 1024).toFixed(1) + " KB" : (f.size / 1024 / 1024).toFixed(1) + " MB";
            const item = document.createElement("div"); item.className = "queue-item";
            item.innerHTML = `<span class="queue-item-icon">${FILE_ICONS[ext] || FILE_ICONS.txt}</span><span class="queue-item-name">${esc(f.name)}</span><span class="queue-item-size">${size}</span><button class="queue-item-remove" data-idx="${i}">&times;</button>`;
            queueList.appendChild(item);
        });
        checkUploadBtn();
    }

    queueList.addEventListener("click", (e) => { if (e.target.classList.contains("queue-item-remove")) { selectedFiles.splice(parseInt(e.target.dataset.idx), 1); renderQueue(); } });
    queueClear.addEventListener("click", () => { selectedFiles = []; renderQueue(); });
    pasteText.addEventListener("input", checkUploadBtn);
    function checkUploadBtn() { uploadBtn.disabled = selectedFiles.length === 0 && !pasteText.value.trim(); }

    // ── Upload ────────────────────────────────────────────────────
    uploadBtn.addEventListener("click", async () => {
        if (uploadBtn.disabled) return;
        const btnText = uploadBtn.querySelector(".btn-text"), btnLoader = uploadBtn.querySelector(".btn-loader");
        btnText.style.display = "none"; btnLoader.style.display = "flex"; uploadBtn.disabled = true;
        uploadProgress.style.display = "block"; uploadResults.style.display = "none";
        progressFill.style.width = "30%"; progressFill.style.background = "linear-gradient(90deg, #6366f1, #a855f7)";
        progressText.textContent = "Uploading files...";
        const formData = new FormData();
        selectedFiles.forEach(f => formData.append("files", f));
        if (pasteText.value.trim()) formData.append("pasted_text", pasteText.value.trim());
        try {
            progressFill.style.width = "60%"; progressText.textContent = "Generating embeddings...";
            const resp = await fetch("/api/upload", { method: "POST", body: formData });
            let data; const ct = resp.headers.get("content-type") || "";
            if (ct.includes("application/json")) { data = await resp.json(); } else { throw new Error(`Server error (${resp.status}).`); }
            progressFill.style.width = "100%";
            showResults(data.processed); if (data.sample_prompts) updateSamplePrompts(data.sample_prompts); refreshDocList();
            if (data.error) { progressText.textContent = "Error: " + data.error; progressFill.style.background = "linear-gradient(90deg, #ef4444, #f59e0b)"; }
            else { progressText.textContent = "Done!"; selectedFiles = []; pasteText.value = ""; renderQueue(); }
        } catch (err) { progressText.textContent = "Upload failed: " + err.message; progressFill.style.width = "100%"; progressFill.style.background = "linear-gradient(90deg, #ef4444, #f59e0b)"; }
        btnText.style.display = "inline"; btnLoader.style.display = "none"; checkUploadBtn();
        setTimeout(() => { uploadProgress.style.display = "none"; progressFill.style.background = "linear-gradient(90deg, #6366f1, #a855f7)"; progressFill.style.width = "0%"; }, 5000);
    });

    function showResults(processed) {
        if (!processed || !processed.length) return;
        uploadResults.style.display = "flex"; uploadResults.innerHTML = "";
        processed.forEach(p => {
            const s = p.status, ic = s === "success" ? "success" : s === "duplicate" ? "duplicate" : "error";
            const d = s === "success" ? `${p.chunks} chunks` : s === "duplicate" ? "Already uploaded" : (p.error || "Failed");
            const ih = s === "success" ? '<i class="bi bi-check-circle-fill"></i>' : s === "duplicate" ? '<i class="bi bi-exclamation-circle-fill"></i>' : '<i class="bi bi-x-circle-fill"></i>';
            const item = document.createElement("div"); item.className = "result-item";
            item.innerHTML = `<div class="result-icon ${ic}">${ih}</div><span class="result-name">${esc(p.name)}</span><span class="result-detail">${esc(d)}</span>`;
            uploadResults.appendChild(item);
        });
    }

    // ── Document List (FIX #15: all names escaped) ────────────────
    async function refreshDocList() {
        try {
            const resp = await fetch("/api/documents"); const data = await resp.json();
            if (data.documents.length === 0) { docList.innerHTML = '<div class="empty-state-small"><i class="bi bi-inbox"></i><span>No documents yet</span></div>'; docStats.style.display = "none"; return; }
            docList.innerHTML = "";
            data.documents.forEach(d => {
                const ext = d.name.split(".").pop().toLowerCase();
                const ic = ["pdf", "docx", "doc", "txt"].includes(ext) ? ext : "text";
                const item = document.createElement("div"); item.className = "doc-item";
                item.innerHTML = `<div class="doc-item-icon ${ic}">${FILE_ICONS[ic] || FILE_ICONS.text}</div><span class="doc-item-name" title="${esc(d.name)}">${esc(d.name)}</span><button class="doc-item-delete" data-hash="${esc(d.hash)}" title="Remove"><i class="bi bi-x-lg"></i></button>`;
                docList.appendChild(item);
            });
            docStats.style.display = "block";
            docStats.textContent = `${data.documents.length} doc${data.documents.length > 1 ? "s" : ""} · ${data.total_chunks} chunks`;
        } catch (err) {}
    }

    docList.addEventListener("click", async (e) => {
        const btn = e.target.closest(".doc-item-delete"); if (!btn) return;
        const hash = btn.dataset.hash, name = btn.closest(".doc-item").querySelector(".doc-item-name").textContent;
        if (!confirm(`Remove "${name}"?`)) return;
        btn.innerHTML = '<div class="spinner-small"></div>'; btn.disabled = true;
        try { const r = await fetch(`/api/documents/${hash}`, { method: "DELETE" }); const ct = r.headers.get("content-type") || ""; if (ct.includes("application/json")) { const d = await r.json(); if (d.sample_prompts) updateSamplePrompts(d.sample_prompts); } } catch (e) {}
        refreshDocList();
    });

    clearAllBtn.addEventListener("click", async () => {
        if (!confirm("Clear all documents and embeddings?")) return;
        await fetch("/api/clear", { method: "POST" }); refreshDocList(); createNewChat();
    });

    // ── Init ──────────────────────────────────────────────────────
    if (chats.length === 0) createNewChat(); else { renderChatHistory(); renderActiveChat(); }
    refreshDocList();
    fetch("/api/prompts").then(r => r.json()).then(d => { if (d.prompts) updateSamplePrompts(d.prompts); }).catch(() => {});

    // ── Text-to-Speech Engine ─────────────────────────────────────
    const synth = window.speechSynthesis;
    let voices = [];
    const voiceSelect = document.getElementById("voice-select");
    const voiceRate = document.getElementById("voice-rate");
    const voicePitch = document.getElementById("voice-pitch");
    const voiceRateVal = document.getElementById("voice-rate-val");
    const voicePitchVal = document.getElementById("voice-pitch-val");
    const autoSpeak = document.getElementById("auto-speak");
    const settingsBtn = document.getElementById("settings-btn");
    const settingsOverlay = document.getElementById("settings-overlay");
    const settingsClose = document.getElementById("settings-close");

    function loadVoices() {
        voices = synth.getVoices();
        if (!voiceSelect) return;
        voiceSelect.innerHTML = "";
        const savedVoice = localStorage.getItem("drdoc_voice") || "";
        voices.forEach((v, i) => {
            const opt = document.createElement("option");
            opt.value = i;
            opt.textContent = `${v.name} (${v.lang})`;
            if (v.name === savedVoice) opt.selected = true;
            voiceSelect.appendChild(opt);
        });
    }

    if (synth) {
        loadVoices();
        synth.onvoiceschanged = loadVoices;
    }

    // Load saved settings
    if (voiceRate) voiceRate.value = localStorage.getItem("drdoc_rate") || "1";
    if (voicePitch) voicePitch.value = localStorage.getItem("drdoc_pitch") || "1";
    if (autoSpeak) autoSpeak.checked = localStorage.getItem("drdoc_autospeak") === "true";
    if (voiceRateVal) voiceRateVal.textContent = (voiceRate?.value || 1) + "x";
    if (voicePitchVal) voicePitchVal.textContent = voicePitch?.value || 1;

    const PREVIEW_TEXT = "Hey there! This is Dr. Doc, testing your voice settings. How does this sound?";

    function previewVoice() {
        if (!synth) return;
        synth.cancel();
        setTimeout(() => speakText(PREVIEW_TEXT), 100);
    }

    if (voiceRate) voiceRate.addEventListener("input", () => { voiceRateVal.textContent = voiceRate.value + "x"; localStorage.setItem("drdoc_rate", voiceRate.value); previewVoice(); });
    if (voicePitch) voicePitch.addEventListener("input", () => { voicePitchVal.textContent = voicePitch.value; localStorage.setItem("drdoc_pitch", voicePitch.value); previewVoice(); });
    if (voiceSelect) voiceSelect.addEventListener("change", () => { const v = voices[voiceSelect.value]; if (v) localStorage.setItem("drdoc_voice", v.name); previewVoice(); });
    if (autoSpeak) autoSpeak.addEventListener("change", () => { localStorage.setItem("drdoc_autospeak", autoSpeak.checked); });

    // Settings modal
    if (settingsBtn) settingsBtn.addEventListener("click", () => { settingsOverlay.style.display = "flex"; });
    if (settingsClose) settingsClose.addEventListener("click", () => { settingsOverlay.style.display = "none"; });
    if (settingsOverlay) settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) settingsOverlay.style.display = "none"; });

    function speakText(text, btn) {
        if (!synth) return;
        if (synth.speaking) { synth.cancel(); if (btn) btn.querySelector("i").className = "bi bi-volume-up-fill"; return; }

        const utter = new SpeechSynthesisUtterance(text);
        const savedVoice = localStorage.getItem("drdoc_voice");
        if (savedVoice) { const v = voices.find(v => v.name === savedVoice); if (v) utter.voice = v; }
        utter.rate = parseFloat(localStorage.getItem("drdoc_rate") || "1");
        utter.pitch = parseFloat(localStorage.getItem("drdoc_pitch") || "1");

        if (btn) {
            btn.querySelector("i").className = "bi bi-stop-circle-fill";
            utter.onend = () => { btn.querySelector("i").className = "bi bi-volume-up-fill"; };
        }

        synth.speak(utter);
    }

    // Auto-speak: hook into assistant message creation
    const origAppend = appendMessageDOM;
    // We patch via the sendMessage flow — after assistant message is added, auto-speak if enabled
    // This is handled by checking autoSpeak after each assistant response in sendMessage
});
