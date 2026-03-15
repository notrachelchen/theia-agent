// sidebar.js — handles voice input, text input, and UI updates

const micBtn      = document.getElementById('mic-btn');
const textInput   = document.getElementById('text-input');
const sendBtn     = document.getElementById('send-btn');
const describeBtn = document.getElementById('describe-btn');
const statusEl    = document.getElementById('status');
const logEl       = document.getElementById('log');

let recognition = null;
let isListening = false;

// ── SPEECH RECOGNITION SETUP ────────────────────────────────────────────────

function setupSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    setStatus('Voice input not supported in this browser', 'error');
    micBtn.disabled = true;
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    micBtn.textContent = '🔴 Listening...';
    micBtn.classList.add('active');
    setStatus('Listening...', 'listening');
  };

  recognition.onresult = (e) => {
    const command = e.results[0][0].transcript;
    addLog(command, 'user');
    processCommand(command);
  };

  recognition.onerror = (e) => {
    setStatus(`Voice error: ${e.error}`, 'error');
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
  };
}

function startListening() {
  if (!recognition) return;
  try {
    recognition.start();
  } catch (e) {
    console.error('Recognition start error:', e);
  }
}

function stopListening() {
  isListening = false;
  micBtn.textContent = '🎤 Hold to speak';
  micBtn.classList.remove('active');
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

// Hold to speak
micBtn.addEventListener('mousedown', startListening);
micBtn.addEventListener('touchstart', startListening);
micBtn.addEventListener('mouseup', () => recognition && recognition.stop());
micBtn.addEventListener('touchend', () => recognition && recognition.stop());

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

// Listen for agent responses from background.js to log them
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AGENT_RESPONSE') {
    hideThinking();
    addLog(msg.text, 'agent');
  }
  if (msg.type === 'AGENT_THINKING') {
    showThinking();
    setStatus('Thinking...', 'thinking');
  }
  if (msg.type === 'AGENT_SPEAKING') {
    setStatus('Speaking...', 'speaking');
  }
});

// ── INIT ─────────────────────────────────────────────────────────────────────

setupSpeechRecognition();
addLog('Assistant ready. Hold the mic button or type a command.', 'agent');