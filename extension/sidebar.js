// sidebar.js — handles voice input, text input, and UI updates

const micBtn         = document.getElementById('mic-btn');
const textInput      = document.getElementById('text-input');
const sendBtn        = document.getElementById('send-btn');
const describeBtn    = document.getElementById('describe-btn');
const statusEl       = document.getElementById('status');
const logEl          = document.getElementById('log');
const liveTranscript = document.getElementById('live-transcript');

let isListening = false;
let isSpeaking = false;
let speakingTimer = null;

// ── MIC CONTROL ─────────────────────────────────────────────────────────────
// Speech recognition runs in the content script (on the real https:// page)
// because chrome-extension:// pages are blocked from mic access in MV3.

function resetSpeaking() {
  clearTimeout(speakingTimer);
  speakingTimer = null;
  isSpeaking = false;
  setMicDisabled(false);
  setStatus('Ready', '');
}

function setMicDisabled(disabled) {
  // Don't use disabled attribute — we need clicks to work for interruption
  if (disabled) {
    micBtn.textContent = '🔇 AI speaking... (tap to stop)';
    micBtn.classList.remove('active');
    micBtn.style.opacity = '0.6';
    micBtn.style.cursor = 'pointer';
  } else {
    micBtn.style.opacity = '';
    micBtn.style.cursor = '';
    if (!isListening) micBtn.textContent = '🎤 Tap to speak';
  }
}

function startListening() {
  if (isSpeaking) return;
  isListening = true;
  micBtn.textContent = '🎙️ Listening...';
  micBtn.classList.add('active');
  setStatus('Listening...', 'listening');
  chrome.runtime.sendMessage({ type: 'START_LISTENING' });
}

function stopListening() {
  isListening = false;
  micBtn.textContent = '🎤 Tap to speak';
  micBtn.classList.remove('active');
  liveTranscript.textContent = '';
  setStatus('Ready', '');
}

// ── COMMAND PROCESSING ───────────────────────────────────────────────────────

async function processCommand(command) {
  if (!command.trim()) return;

  setStatus('Thinking...', 'thinking');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const response = await chrome.runtime.sendMessage({
      type: 'USER_COMMAND',
      command: command,
      tabId: tab.id
    });

    if (response && response.error) {
      addLog(`Error: ${response.error}`, 'error');
      setStatus('Error — try again', 'error');
    } else {
      setStatus('Ready', '');
    }

  } catch (err) {
    addLog(`Failed: ${err.message}`, 'error');
    setStatus('Error — try again', 'error');
  }
}

async function describeCurrentPage() {
  setStatus('Describing page...', 'thinking');
  addLog('Describe current page', 'user');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({
      type: 'USER_COMMAND',
      command: `describe what is currently on this page`,
      tabId: tab.id
    });
    setStatus('Ready', '');
  } catch (err) {
    setStatus('Error', 'error');
  }
}

// ── UI HELPERS ───────────────────────────────────────────────────────────────

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = type;
}

function addLog(text, type = 'agent') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = text;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;

  // Cap log at 50 entries
  while (logEl.children.length > 50) {
    logEl.removeChild(logEl.firstChild);
  }
}

function showThinking() {
  const entry = document.createElement('div');
  entry.className = 'log-entry agent';
  entry.id = 'thinking-indicator';
  entry.innerHTML = `<span class="dot-pulse"><span></span><span></span><span></span></span>`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function hideThinking() {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

// ── EVENT LISTENERS ──────────────────────────────────────────────────────────

// Tap to toggle listening; tap while AI speaks to interrupt and re-enable
micBtn.addEventListener('click', () => {
  if (isSpeaking) {
    chrome.tts.stop();
    chrome.runtime.sendMessage({ type: 'STOP_AUDIO' }).catch(() => {});
    resetSpeaking();
    return;
  }
  if (isListening) {
    chrome.runtime.sendMessage({ type: 'STOP_LISTENING' });
    stopListening();
  } else {
    startListening();
  }
});

// Text input — send on Enter or button click
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && textInput.value.trim()) {
    const command = textInput.value.trim();
    textInput.value = '';
    addLog(command, 'user');
    processCommand(command);
  }
});

sendBtn.addEventListener('click', () => {
  if (textInput.value.trim()) {
    const command = textInput.value.trim();
    textInput.value = '';
    addLog(command, 'user');
    processCommand(command);
  }
});

// Describe page button
describeBtn.addEventListener('click', describeCurrentPage);

// Listen for messages from background.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AGENT_RESPONSE') {
    hideThinking();
    addLog(msg.text, 'agent');
  }
  if (msg.type === 'AGENT_THINKING') {
    showThinking();
    setStatus('Thinking...', 'thinking');
  }
  if (msg.type === 'AGENT_SPEAKING_START') {
    isSpeaking = true;
    setMicDisabled(true);
    setStatus('Speaking...', 'speaking');
    // Safety timeout — re-enable button if AGENT_SPEAKING_END never arrives
    clearTimeout(speakingTimer);
    speakingTimer = setTimeout(() => resetSpeaking(), 30000);
  }
  if (msg.type === 'AGENT_SPEAKING_END') {
    resetSpeaking();
  }

  // Voice results relayed from content script
  if (msg.type === 'VOICE_INTERIM') {
    liveTranscript.textContent = msg.transcript;
  }
  if (msg.type === 'VOICE_RESULT') {
    liveTranscript.textContent = '';
    stopListening();
    addLog(msg.transcript, 'user');
    processCommand(msg.transcript);
  }
  if (msg.type === 'VOICE_ERROR') {
    console.error('[mic] error:', msg.error);
    setStatus(`Voice error: ${msg.error}`, 'error');
    stopListening();
  }
  if (msg.type === 'VOICE_END') {
    if (isListening) stopListening();
  }
});

// ── INIT ─────────────────────────────────────────────────────────────────────

addLog('Assistant ready. Tap the mic button or type a command.', 'agent');