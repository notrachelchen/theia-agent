// content.js — injected into every tab
// Executes clicks, typing, scrolling, and speech recognition on behalf of the agent

// Guard against being injected twice (manifest + dynamic injection)
if (window.__theiaAgent) {
  // Already loaded — do nothing
} else {
window.__theiaAgent = true;

let _recognition = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── SPEECH RECOGNITION ───────────────────────────────────────────────────
  // Runs here (on the real https:// page) because chrome-extension:// pages
  // are blocked from mic access in MV3.
  if (msg.type === 'START_LISTENING') {
    if (_recognition) { try { _recognition.abort(); } catch(e) {} }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      chrome.runtime.sendMessage({ type: 'VOICE_ERROR', error: 'not-supported' });
      sendResponse({ ok: false });
      return true;
    }

    _recognition = new SR();
    _recognition.continuous = false;
    _recognition.interimResults = true;
    _recognition.lang = 'en-US';

    _recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (const result of e.results) {
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) chrome.runtime.sendMessage({ type: 'VOICE_INTERIM', transcript: interim });
      if (final)   chrome.runtime.sendMessage({ type: 'VOICE_RESULT', transcript: final });
    };

    _recognition.onerror = (e) => {
      chrome.runtime.sendMessage({ type: 'VOICE_ERROR', error: e.error });
    };

    _recognition.onend = () => {
      chrome.runtime.sendMessage({ type: 'VOICE_END' });
      _recognition = null;
    };

    _recognition.start();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'STOP_LISTENING') {
    if (_recognition) { try { _recognition.stop(); } catch(e) {} }
    sendResponse({ ok: true });
    return true;
  }

    // ── CLICK ────────────────────────────────────────────────────────────────
    if (msg.type === 'EXECUTE_CLICK') {
      try {
        const el = document.elementFromPoint(msg.x, msg.y);
        if (!el) {
          sendResponse({ success: false, error: 'No element at coordinates' });
          return;
        }
  
        const opts = {
          bubbles: true,
          cancelable: true,
          clientX: msg.x,
          clientY: msg.y,
          screenX: msg.x,
          screenY: msg.y,
        };
  
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
  
        sendResponse({ success: true, tag: el.tagName, text: el.textContent?.trim().slice(0, 50) });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }
  
    // ── TYPE ─────────────────────────────────────────────────────────────────
    if (msg.type === 'EXECUTE_TYPE') {
      try {
        const el = document.activeElement;
        if (!el) {
          sendResponse({ success: false, error: 'No active element to type into' });
          return;
        }
  
        // Focus and clear if needed
        el.focus();
        if (msg.clear) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
  
        // Type each character
        document.execCommand('insertText', false, msg.text);
  
        // Dispatch events so React/Vue/Angular pick up the change
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
  
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }
  
    // ── SCROLL ───────────────────────────────────────────────────────────────
    if (msg.type === 'EXECUTE_SCROLL') {
      try {
        const amount = msg.direction === 'down' ? 400 : -400;
        window.scrollBy({ top: amount, behavior: 'smooth' });
        sendResponse({ success: true, newScrollY: window.scrollY + amount });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }
  
    // ── KEY PRESS ────────────────────────────────────────────────────────────
    if (msg.type === 'EXECUTE_KEY') {
      try {
        const el = document.activeElement || document.body;
        el.dispatchEvent(new KeyboardEvent('keydown', {
          key: msg.key,
          bubbles: true,
          cancelable: true
        }));
        el.dispatchEvent(new KeyboardEvent('keyup', {
          key: msg.key,
          bubbles: true
        }));
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }
  
    return true; // keep message channel open for async
  });

} // end __theiaAgent guard