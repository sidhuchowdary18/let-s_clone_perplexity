// ═══════════════════════════════════════════════════════════════
//  Claude Clone — PDF RAG Chat (Gemini 2.5 Flash, Browser-Only)
//  Uses PDF.js (browser PyPDF2 equivalent) + Gemini REST API
// ═══════════════════════════════════════════════════════════════

// ─── Config ───
const GEMINI_API_KEY = "AIzaSyAwaEJPXy3bpalGn0ELbJniswcSCLhEtl8";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─── State ───
let pdfText = "";           // Extracted PDF text (the knowledge base)
let pdfFileName = "";
let pdfPageCount = 0;
let conversationHistory = [];
let isProcessing = false;

// ─── DOM Elements ───
const searchArea      = document.getElementById('search-input');
const submitBtn       = document.getElementById('submit-btn');
const chatContainer   = document.getElementById('chat-container');
const promptsContainer = document.getElementById('prompts-container');
const promptsList     = document.getElementById('prompts-list');
const tabButtons      = document.querySelectorAll('.tab-btn');

// PDF elements
const uploadZone    = document.getElementById('upload-zone');
const pdfInput      = document.getElementById('pdf-input');
const uploadContent = document.getElementById('upload-content');
const uploadProgress = document.getElementById('upload-progress');
const progressFill  = document.getElementById('progress-fill');
const progressText  = document.getElementById('progress-text');
const pdfBadge      = document.getElementById('pdf-badge');
const pdfFileLabel  = document.getElementById('pdf-filename');
const pdfPagesLabel = document.getElementById('pdf-pages');
const pdfCharsLabel = document.getElementById('pdf-chars');
const pdfRemoveBtn  = document.getElementById('pdf-remove');
const ragIndicator  = document.getElementById('rag-indicator');
const attachBtn     = document.getElementById('attach-btn');
const clearChatBtn  = document.getElementById('clear-chat-btn');
const micBtn        = document.getElementById('mic-btn');
const micIcon       = document.getElementById('mic-icon');
const micPulse      = document.getElementById('mic-pulse');

// History elements
const historySidebar  = document.getElementById('history-sidebar');
const historyOverlay  = document.getElementById('history-overlay');
const historyToggle   = document.getElementById('history-toggle-btn');
const historyCloseBtn = document.getElementById('history-close-btn');
const historyList     = document.getElementById('history-list');
const historyEmpty    = document.getElementById('history-empty');
const historyClearBtn = document.getElementById('history-clear-btn');

// ═══════════════════════════════════════════════════════════════
//  PDF EXTRACTION (Browser-based PyPDF2 equivalent using PDF.js)
// ═══════════════════════════════════════════════════════════════

async function extractPDFText(file) {
    return new Promise(async (resolve, reject) => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            pdfPageCount = pdf.numPages;
            let fullText = "";

            for (let i = 1; i <= pdf.numPages; i++) {
                // Update progress
                const percent = Math.round((i / pdf.numPages) * 100);
                progressFill.style.width = percent + '%';
                progressText.textContent = `Extracting page ${i} of ${pdf.numPages}...`;

                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items.map(item => item.str).join(' ');
                fullText += `\n--- Page ${i} ---\n${pageText}\n`;
            }

            resolve(fullText.trim());
        } catch (err) {
            reject(err);
        }
    });
}

// ─── Handle file upload ───
async function handlePDFUpload(file) {
    if (!file || file.type !== 'application/pdf') {
        alert('Please upload a valid PDF file.');
        return;
    }

    pdfFileName = file.name;

    // Show progress
    uploadContent.style.display = 'none';
    uploadProgress.style.display = 'block';
    progressFill.style.width = '0%';

    try {
        pdfText = await extractPDFText(file);
        
        // Show success
        progressText.textContent = '✓ Extraction complete!';
        progressFill.style.width = '100%';

        setTimeout(() => {
            // Hide upload zone, show badge
            uploadZone.style.display = 'none';
            pdfBadge.style.display = 'flex';
            ragIndicator.style.display = 'flex';

            // Update badge info
            pdfFileLabel.textContent = pdfFileName;
            pdfPagesLabel.textContent = `• ${pdfPageCount} pages`;
            pdfCharsLabel.textContent = `• ${pdfText.length.toLocaleString()} chars`;

            // Update placeholder
            searchArea.placeholder = `Ask anything about "${pdfFileName}"...`;
        }, 600);

    } catch (error) {
        console.error('PDF extraction error:', error);
        progressText.textContent = '❌ Failed to extract PDF text';
        setTimeout(() => {
            uploadContent.style.display = 'block';
            uploadProgress.style.display = 'none';
        }, 2000);
    }
}

// ─── Remove PDF ───
function removePDF() {
    pdfText = "";
    pdfFileName = "";
    pdfPageCount = 0;

    uploadZone.style.display = 'block';
    uploadContent.style.display = 'block';
    uploadProgress.style.display = 'none';
    pdfBadge.style.display = 'none';
    ragIndicator.style.display = 'none';
    
    searchArea.placeholder = "Ask anything...";
    pdfInput.value = '';
}

// ═══════════════════════════════════════════════════════════════
//  UPLOAD EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

// Click to upload
uploadZone.addEventListener('click', () => pdfInput.click());
attachBtn.addEventListener('click', () => pdfInput.click());

pdfInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handlePDFUpload(e.target.files[0]);
});

// Drag & Drop
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handlePDFUpload(file);
});

// Remove PDF
pdfRemoveBtn.addEventListener('click', removePDF);

// ═══════════════════════════════════════════════════════════════
//  RAG — RETRIEVAL AUGMENTED GENERATION
// ═══════════════════════════════════════════════════════════════

function buildRAGPrompt(userQuery) {
    if (!pdfText) return userQuery;

    // Chunk the PDF text (keep under token limits, ~30k chars is safe)
    const maxChars = 30000;
    const contextText = pdfText.length > maxChars
        ? pdfText.substring(0, maxChars) + "\n\n[... Document truncated for length ...]"
        : pdfText;

    return `You are an intelligent assistant. Use the following PDF document content as your knowledge base to answer the user's question accurately. If the answer is not in the document, say so clearly.

═══ DOCUMENT CONTENT ═══
${contextText}
═══ END OF DOCUMENT ═══

User's Question: ${userQuery}

Instructions:
- Base your answer primarily on the document content above (RAG approach)
- Be specific and cite relevant sections when possible
- If the question cannot be answered from the document alone, clearly state that
- Format your response clearly with paragraphs or bullet points as appropriate`;
}

// ═══════════════════════════════════════════════════════════════
//  GEMINI API CALL
// ═══════════════════════════════════════════════════════════════

async function callGemini(userMessage) {
    // Build the RAG-enhanced prompt
    const enhancedPrompt = buildRAGPrompt(userMessage);

    // Add to history (store original user message for display)
    conversationHistory.push({
        role: "user",
        parts: [{ text: enhancedPrompt }]
    });

    const requestBody = {
        contents: conversationHistory,
        generationConfig: {
            temperature: 0.4,    // Lower temp for factual RAG answers
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192
        }
    };

    const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response received.";

    // Add model response to history
    conversationHistory.push({
        role: "model",
        parts: [{ text: aiText }]
    });

    // Keep history manageable
    if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-10);
    }

    return aiText;
}

// ═══════════════════════════════════════════════════════════════
//  CHAT UI
// ═══════════════════════════════════════════════════════════════

function addMessage(role, text) {
    chatContainer.style.display = 'flex';
    promptsContainer.style.display = 'none';

    const msg = document.createElement('div');
    msg.className = `chat-message ${role}`;

    const label = document.createElement('div');
    label.className = `message-label ${role}-label`;
    
    if (role === 'user') {
        label.innerHTML = '<i class="fa-regular fa-user"></i> You';
    } else {
        label.innerHTML = '<i class="fa-solid fa-sparkles"></i> Claude';
    }

    const content = document.createElement('div');
    content.className = 'message-content';

    msg.appendChild(label);
    msg.appendChild(content);
    chatContainer.appendChild(msg);

    // Scroll to bottom
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    return content;
}

function addLoadingMessage() {
    chatContainer.style.display = 'flex';
    promptsContainer.style.display = 'none';

    const msg = document.createElement('div');
    msg.className = 'chat-message ai';
    msg.id = 'loading-msg';

    const label = document.createElement('div');
    label.className = 'message-label ai-label';
    label.innerHTML = '<i class="fa-solid fa-sparkles"></i> Claude';

    const dots = document.createElement('div');
    dots.className = 'loading-indicator';
    dots.innerHTML = '<span></span><span></span><span></span>';

    msg.appendChild(label);
    msg.appendChild(dots);
    chatContainer.appendChild(msg);

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function removeLoadingMessage() {
    const el = document.getElementById('loading-msg');
    if (el) el.remove();
}

// Typing effect
function typeEffect(element, text, callback) {
    element.textContent = "";
    let i = 0;
    const speed = 8;
    const interval = setInterval(() => {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            if (i % 40 === 0) {
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }
        } else {
            clearInterval(interval);
            if (callback) callback();
        }
    }, speed);
}

// ═══════════════════════════════════════════════════════════════
//  SEARCH / SUBMIT
// ═══════════════════════════════════════════════════════════════

async function performSearch() {
    const query = searchArea.value.trim();
    if (!query || isProcessing) return;

    isProcessing = true;
    submitBtn.disabled = true;

    // Show user message
    addMessage('user', query);
    searchArea.value = '';
    searchArea.style.height = 'auto';

    // Show loading
    addLoadingMessage();

    try {
        const aiResponse = await callGemini(query);
        removeLoadingMessage();
        const contentEl = addMessage('ai', '');
        typeEffect(contentEl, aiResponse, () => {
            isProcessing = false;
            submitBtn.disabled = false;
        });
    } catch (error) {
        removeLoadingMessage();
        const contentEl = addMessage('ai', '');
        contentEl.textContent = "⚠️ Error: " + error.message;
        contentEl.style.color = '#f87171';
        isProcessing = false;
        submitBtn.disabled = false;
        console.error("Gemini API Error:", error);
    }
}

// ═══════════════════════════════════════════════════════════════
//  PROMPTS / TABS
// ═══════════════════════════════════════════════════════════════

const promptData = {
    pdf: [
        "Summarize the key points of this document",
        "What are the main findings or conclusions?",
        "Extract all dates, names, and numbers mentioned",
        "Explain the most complex section in simple terms",
        "Create a bullet-point outline of this document"
    ],
    general: [
        "Explain quantum computing in simple terms",
        "What are the best practices for remote work?",
        "Compare React vs Vue for a new project",
        "How does blockchain technology work?",
        "Write a professional email template"
    ],
    learn: [
        "How do neural networks actually work?",
        "Explain the theory of relativity simply",
        "What is retrieval augmented generation (RAG)?",
        "Summary of 'Thinking Fast and Slow'",
        "Explain the JavaScript event loop"
    ],
    code: [
        "Write a Python function to parse a CSV file",
        "Create a REST API endpoint in Flask",
        "Explain Big O notation with examples",
        "Write a binary search algorithm in JavaScript",
        "Create a SQL query for user analytics"
    ]
};

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        updatePrompts(button.getAttribute('data-tab'));
    });
});

function updatePrompts(type) {
    promptsList.style.opacity = '0';
    setTimeout(() => {
        promptsList.innerHTML = '';
        promptData[type].forEach(text => {
            const li = document.createElement('li');
            li.textContent = text;
            li.addEventListener('click', () => {
                searchArea.value = text;
                searchArea.focus();
                searchArea.dispatchEvent(new Event('input'));
            });
            promptsList.appendChild(li);
        });
        promptsList.style.opacity = '1';
    }, 200);
}

// Add click to initial list items
document.querySelectorAll('.prompts-list li').forEach(item => {
    item.addEventListener('click', () => {
        searchArea.value = item.textContent;
        searchArea.focus();
        searchArea.dispatchEvent(new Event('input'));
    });
});

// ═══════════════════════════════════════════════════════════════
//  CLEAR CHAT
// ═══════════════════════════════════════════════════════════════

clearChatBtn.addEventListener('click', () => {
    conversationHistory = [];
    chatContainer.innerHTML = '';
    chatContainer.style.display = 'none';
    promptsContainer.style.display = 'block';
    searchArea.value = '';
});

// ═══════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

// Auto-grow textarea
searchArea.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    if (this.scrollHeight > 200) {
        this.style.overflowY = 'scroll';
        this.style.height = '200px';
    } else {
        this.style.overflowY = 'hidden';
    }
});

// Submit
submitBtn.addEventListener('click', performSearch);

searchArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        performSearch();
    }
});

// Focus on load
window.onload = () => {
    searchArea.focus();
    renderHistory();
};

// ═══════════════════════════════════════════════════════════════
//  SEARCH HISTORY — Last 5 Searches (localStorage)
// ═══════════════════════════════════════════════════════════════

const HISTORY_KEY = 'claude_search_history';
const MAX_HISTORY = 5;

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
        return [];
    }
}

function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addToHistory(query) {
    let history = getHistory();

    // Don't add duplicates (if same query is at position 0, skip)
    if (history.length > 0 && history[0].query === query) return;

    const entry = {
        query: query,
        timestamp: Date.now(),
        hasPDF: !!pdfText,
        pdfName: pdfFileName || null
    };

    // Add to front, keep only last 5
    history.unshift(entry);
    history = history.slice(0, MAX_HISTORY);
    saveHistory(history);
    renderHistory();
}

function removeFromHistory(index) {
    let history = getHistory();
    history.splice(index, 1);
    saveHistory(history);
    renderHistory();
}

function clearAllHistory() {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
}

function renderHistory() {
    const history = getHistory();

    // Clear existing items (keep the empty state element)
    const items = historyList.querySelectorAll('.history-item');
    items.forEach(item => item.remove());

    if (history.length === 0) {
        historyEmpty.style.display = 'flex';
        return;
    }

    historyEmpty.style.display = 'none';

    history.forEach((entry, index) => {
        const item = document.createElement('div');
        item.className = 'history-item';

        const timeAgo = getTimeAgo(entry.timestamp);

        item.innerHTML = `
            <div class="history-item-query">${escapeHtml(entry.query)}</div>
            <div class="history-item-meta">
                <i class="fa-regular fa-clock"></i> ${timeAgo}
                ${entry.hasPDF ? `<span class="history-item-badge">PDF</span>` : ''}
                <button class="history-item-delete" aria-label="Delete" data-index="${index}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;

        // Click to re-use the query
        item.addEventListener('click', (e) => {
            if (e.target.closest('.history-item-delete')) return;
            searchArea.value = entry.query;
            searchArea.focus();
            searchArea.dispatchEvent(new Event('input'));
            closeHistory();
        });

        // Delete single item
        const deleteBtn = item.querySelector('.history-item-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromHistory(index);
        });

        historyList.appendChild(item);
    });
}

function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Sidebar Open / Close ───
function openHistory() {
    historySidebar.classList.add('active');
    historyOverlay.classList.add('active');
    renderHistory();
}

function closeHistory() {
    historySidebar.classList.remove('active');
    historyOverlay.classList.remove('active');
}

historyToggle.addEventListener('click', openHistory);
historyCloseBtn.addEventListener('click', closeHistory);
historyOverlay.addEventListener('click', closeHistory);
historyClearBtn.addEventListener('click', () => {
    clearAllHistory();
});

// ═══════════════════════════════════════════════════════════════
//  VOICE INPUT — Web Speech API (Microphone Access)
// ═══════════════════════════════════════════════════════════════

let recognition = null;
let isRecording = false;
let voiceStatusEl = null;

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        micBtn.title = 'Voice input not supported in this browser';
        micBtn.style.opacity = '0.3';
        micBtn.style.cursor = 'not-allowed';
        micBtn.addEventListener('click', () => {
            alert('⚠️ Voice input is not supported in this browser.\nPlease use Google Chrome or Microsoft Edge.');
        });
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    // ─── On Result ───
    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }

        // Show live transcription in the textarea
        if (finalTranscript) {
            searchArea.value += finalTranscript;
        }

        // Update voice status with interim text
        if (voiceStatusEl && interimTranscript) {
            const statusText = voiceStatusEl.querySelector('.voice-status-text');
            if (statusText) {
                statusText.textContent = interimTranscript || 'Listening...';
            }
        }

        // Auto-resize textarea
        searchArea.dispatchEvent(new Event('input'));
    };

    // ─── On End ───
    recognition.onend = () => {
        if (isRecording) {
            // Restart if still recording (browser may auto-stop)
            try { recognition.start(); } catch(e) {}
        } else {
            stopRecordingUI();
        }
    };

    // ─── On Error ───
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        stopRecording();

        if (event.error === 'not-allowed') {
            alert('🎤 Microphone access was denied.\nPlease allow microphone access in your browser settings.');
        } else if (event.error === 'no-speech') {
            // Silently restart if no speech detected
        } else {
            alert('⚠️ Voice error: ' + event.error);
        }
    };

    // ─── Mic Button Click ───
    micBtn.addEventListener('click', toggleRecording);
}

function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    if (!recognition) return;

    isRecording = true;
    micBtn.classList.add('recording');
    micIcon.className = 'fa-solid fa-stop';

    // Show voice status bar
    showVoiceStatus();

    try {
        recognition.start();
    } catch (e) {
        console.error('Failed to start recognition:', e);
        stopRecording();
    }
}

function stopRecording() {
    isRecording = false;
    if (recognition) {
        try { recognition.stop(); } catch(e) {}
    }
    stopRecordingUI();
}

function stopRecordingUI() {
    micBtn.classList.remove('recording');
    micIcon.className = 'fa-solid fa-microphone';
    removeVoiceStatus();

    // Auto-focus the textarea so user can review/edit
    searchArea.focus();
}

function showVoiceStatus() {
    removeVoiceStatus();

    voiceStatusEl = document.createElement('div');
    voiceStatusEl.className = 'voice-status';
    voiceStatusEl.id = 'voice-status';
    voiceStatusEl.innerHTML = `
        <i class="fa-solid fa-microphone"></i>
        <span class="voice-status-text">Listening...</span>
        <div class="voice-waves">
            <span></span><span></span><span></span><span></span><span></span>
        </div>
    `;

    // Insert after the search container
    const searchContainer = document.querySelector('.search-container');
    searchContainer.parentNode.insertBefore(voiceStatusEl, searchContainer.nextSibling);
}

function removeVoiceStatus() {
    const el = document.getElementById('voice-status');
    if (el) el.remove();
    voiceStatusEl = null;
}

// Initialize speech recognition on load
initSpeechRecognition();
