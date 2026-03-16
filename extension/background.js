// background.js — service worker
// Handles: page load orientation, screenshot capture,
//          routing commands to ADK backend

// Open sidebar when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

const BACKEND = 'http://localhost:8000';
const APP_NAME = 'my_agent';
const USER_ID = 'user';

const TTS_SAMPLE_RATE = 24000;

// Each command gets a fresh session so ADK always starts from the root agent.
// Without this, ADK keeps the last active sub-agent as the entry point for
// the next call, causing action tasks to be handled by orientation and vice versa.
function newSessionId() {
  return 'session_' + Date.now();
}

// ── PAGE LOAD TRIGGERS ──────────────────────────────────────────────────────

// Fire orientation when a page finishes loading
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || tab.url.startsWith('chrome://')) return;
  if (tab.url.startsWith('chrome-extension://')) return;

  // Only fire for the active tab
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  if (!activeTab || activeTab.id !== tabId) return;

  await triggerOrientation(tabId, tab);
});

// Fire orientation when user switches tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome://')) return;
    if (tab.url.startsWith('chrome-extension://')) return;
    await triggerOrientation(tabId, tab);
  } catch (e) {
    console.error('Tab activation error:', e);
  }
});

// ── ORIENTATION ─────────────────────────────────────────────────────────────

async function triggerOrientation(tabId, tab) {
  try {
    // Wait for page to fully render before screenshotting
    await sleep(800);

    const capture = await captureWithMeta(tabId);

    const result = await callBackend(
      `orientation task. Page just loaded.` +
      ` Title: ${tab.title}.` +
      ` URL: ${tab.url}.` +
      ` Viewport: ${capture.vw}x${capture.vh}.` +
      ` ScrollY: ${capture.scrollY}.` +
      ` DPR: ${capture.dpr}`,
      capture.base64,
      newSessionId()
    );

    const description = extractSpeakableText(result);
    if (description) await speak(description);

  } catch (err) {
    console.error('Orientation failed:', err);
  }
}

// ── MESSAGE HANDLER ─────────────────────────────────────────────────────────
// Receives messages from sidebar.js (user voice commands)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'USER_COMMAND') {
    handleUserCommand(msg.command, msg.tabId)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async
  }

  if (msg.type === 'CAPTURE') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => captureWithMeta(tab.id))
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ── USER COMMAND HANDLER ────────────────────────────────────────────────────

// ── CLICK EXECUTION ──────────────────────────────────────────────────────────

async function executeClick(tabId, x, y) {
  // Try the content script listener first; if the tab was open before the
  // extension loaded the content script won't be connected, so fall back to
  // scripting.executeScript which injects the click directly.
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_CLICK', x, y });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (cx, cy) => {
        const el = document.elementFromPoint(cx, cy);
        if (!el) return;
        const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy,
                       screenX: cx, screenY: cy };
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup',  opts));
        el.dispatchEvent(new MouseEvent('click',    opts));
      },
      args: [x, y]
    });
  }
}

const ORIENTATION_KEYWORDS = ['describe', 'what do you see', 'where am i', 'what is on', "what's on", 'what page', 'tell me about', 'read the page', 'read this page'];

function isOrientationCommand(command) {
  const lower = command.toLowerCase();
  return ORIENTATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function handleUserCommand(command, tabId) {
  try {
    // Acknowledge immediately so user knows we heard them
    await speak('Got it, looking...');

    // Fresh screenshot at command time
    const capture = await captureWithMeta(tabId);

    const orientation = isOrientationCommand(command);
    let prompt;

    if (orientation) {
      const tab = await chrome.tabs.get(tabId);
      prompt =
        `orientation task. User command: "${command}".` +
        ` Title: ${tab.title}.` +
        ` URL: ${tab.url}.` +
        ` Viewport: ${capture.vw}x${capture.vh}.` +
        ` ScrollY: ${capture.scrollY}.` +
        ` DPR: ${capture.dpr}`;
    } else {
      prompt =
        `action task. User command: "${command}".` +
        ` Viewport: ${capture.vw}x${capture.vh}.` +
        ` DPR: ${capture.dpr}.` +
        ` ScrollY: ${capture.scrollY}`;
    }

    // Each command gets its own session so ADK always starts from the root agent
    const sessionId = newSessionId();
    const result = await callBackend(prompt, capture.base64, sessionId);

    // Check if grounder found and located the element
    const grounderData = extractGrounderData(result);
    const actorData    = extractActorJSON(result);

    // ── SCROLL ──────────────────────────────────────────────────────────────
    if (actorData?.operation === 'scroll') {
      const dir = (actorData.scroll_direction || 'down').toLowerCase();
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: (d) => {
          // Find the next section boundary below (or above) the current viewport edge
          const viewportH = window.innerHeight;
          const currentY  = window.scrollY;
          const direction = d === 'up' ? -1 : 1;

          // Look for a heading or section element just past the viewport edge
          const candidates = Array.from(
            document.querySelectorAll('section, article, [id], h1, h2, h3, h4, nav, header, footer, main')
          );
          let target = null;
          if (direction === 1) {
            // scrolling down: find first element whose top is below the current bottom edge
            const bottomEdge = currentY + viewportH;
            for (const el of candidates) {
              const top = el.getBoundingClientRect().top + currentY;
              if (top > bottomEdge + 10) { target = top; break; }
            }
          } else {
            // scrolling up: find last element whose top is above the current top edge
            const topEdge = currentY;
            for (const el of [...candidates].reverse()) {
              const top = el.getBoundingClientRect().top + currentY;
              if (top < topEdge - 10) { target = top; break; }
            }
          }

          // Fall back to one full viewport height if no section found
          const amount = target !== null ? target - currentY : direction * viewportH;
          window.scrollBy({ top: amount, left: 0, behavior: 'smooth' });
        },
        args: [dir]
      });
      await sleep(800);
      await postActionOrientation(activeTab.id, command);
      return { success: true };
    }

    // ── NAVIGATE ────────────────────────────────────────────────────────────
    if (actorData?.operation === 'navigate' && actorData.text) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: (url) => { window.location.href = url; },
        args: [actorData.text]
      });
      await sleep(1500);
      await postActionOrientation(activeTab.id, command);
      return { success: true };
    }

    // Compute CSS coordinates from box_2d — do the math here, not in the model
    let css_x = null, css_y = null;
    if (grounderData && grounderData.found === true && grounderData.box_2d) {
      const [ymin, xmin, ymax, xmax] = grounderData.box_2d;
      css_x = (xmin + xmax) / 2 / 1000 * capture.vw;
      css_y = (ymin + ymax) / 2 / 1000 * capture.vh;
    }

    if (css_x !== null && css_y !== null && (css_x > 0 || css_y > 0)) {
      // Execute the click in the content script
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      await executeClick(activeTab.id, css_x, css_y);

      // Small wait for page to react
      await sleep(600);
      await postActionOrientation(activeTab.id, command);

    } else {
      // Element not found or orientation response — speak feedback
      const notFound = actorData?.not_found_message;
      const fallback = extractSpeakableText(result);
      await speak(notFound || fallback || "I couldn't find that element on the page.");
    }

    return { success: true };

  } catch (err) {
    console.error('Command failed:', err);
    await speak('Sorry, something went wrong. Please try again.');
    return { error: err.message };
  }
}

async function postActionOrientation(tabId, command) {
  const afterCapture = await captureWithMeta(tabId);
  const afterTab = await chrome.tabs.get(tabId);
  const orientResult = await callBackend(
    `orientation task. Action just completed: "${command}".` +
    ` Describe what changed and current page state.` +
    ` Title: ${afterTab.title}.` +
    ` URL: ${afterTab.url}.` +
    ` Viewport: ${afterCapture.vw}x${afterCapture.vh}.` +
    ` ScrollY: ${afterCapture.scrollY}`,
    afterCapture.base64,
    newSessionId()
  );
  const orientText = extractSpeakableText(orientResult);
  if (orientText) await speak(orientText);
}

// ── ADK BACKEND CALL ────────────────────────────────────────────────────────

async function ensureSession(sessionId) {
  const res = await fetch(
    `${BACKEND}/apps/${APP_NAME}/users/${USER_ID}/sessions/${sessionId}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
  );
  if (res.ok || res.status === 409) return;
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (String(body.detail || '').includes('already exists')) return;
  }
  if (!res.ok) throw new Error(`Session create failed: ${res.status}`);
}

async function callBackend(message, base64Image, sessionId) {
  await ensureSession(sessionId);

  const body = {
    app_name: APP_NAME,
    user_id: USER_ID,
    session_id: sessionId,
    new_message: {
      role: 'user',
      parts: []
    }
  };

  if (base64Image) {
    body.new_message.parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: base64Image
      }
    });
  }

  body.new_message.parts.push({ text: message });

  const res = await fetch(`${BACKEND}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errBody = await res.text();
    let errMsg = `Backend error: ${res.status}`;
    try {
      const parsed = JSON.parse(errBody);
      if (parsed.detail) errMsg += ` — ${typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail)}`;
    } catch {
      if (errBody && errBody.length < 200) errMsg += ` — ${errBody}`;
    }
    throw new Error(errMsg);
  }
  return res.json();
}

// ── SCREENSHOT ──────────────────────────────────────────────────────────────

async function captureWithMeta(tabId) {
  // Get the tab's windowId — use this instead of activeTab
  const tab = await chrome.tabs.get(tabId);
  
  const dataUrl = await chrome.tabs.captureVisibleTab(
    tab.windowId,           // ← pass windowId explicitly
    { format: 'png' }
  );
  const base64 = dataUrl.replace('data:image/png;base64,', '');

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      vw: window.innerWidth,
      vh: window.innerHeight,
      dpr: window.devicePixelRatio,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
    })
  });

  return { base64, ...result };
}
// ── TTS (Gemini) ─────────────────────────────────────────────────────────────

async function speak(text) {
  try {
    const { base64, mimeType } = await fetchTTS(text);
    await ensureOffscreen();
    // offscreen.js stops any current audio before playing new audio
    await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'PLAY_AUDIO', base64, mimeType, sampleRate: TTS_SAMPLE_RATE },
        (resp) => {
          if (chrome.runtime.lastError) {
            console.error('[TTS] sendMessage error:', chrome.runtime.lastError.message);
          } else {
            console.log('[TTS] playback response:', resp);
          }
          resolve();
        }
      );
    });
  } catch (err) {
    console.error('TTS error:', err);
  }
}

async function fetchTTS(text) {
  // Proxied through the local backend — API key stays in .env, never in extension
  const res = await fetch(`${BACKEND}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return { base64: data.audioContent, mimeType: data.mimeType || 'audio/pcm' };
}

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play Gemini TTS audio for blind user assistant'
    });
    // Wait for the page to load and register its message listener
    await sleep(300);
  }
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractText(result) {
  // ADK /run returns an array of events directly (not {events: [...]})
  const events = Array.isArray(result) ? result : result?.events;
  if (!events) return null;
  const textParts = events
    .filter(e => e.content && e.content.parts)
    .flatMap(e => e.content.parts)
    .filter(p => p.text)
    .map(p => p.text);
  return textParts[textParts.length - 1] || null;
}

function extractSpeakableText(result) {
  const raw = extractText(result);
  if (!raw) return null;
  // Agents return JSON like {"description":"..."} or {"narration":"..."} — unwrap it
  try {
    const parsed = JSON.parse(raw);
    return parsed.description || parsed.narration || parsed.not_found_message || raw;
  } catch {
    return raw;
  }
}

function extractGrounderData(result) {
  const events = Array.isArray(result) ? result : result?.events;
  if (!events) return null;
  const textParts = events
    .filter(e => e.content && e.content.parts)
    .flatMap(e => e.content.parts)
    .filter(p => p.text)
    .map(p => p.text);
  // Find the grounder's output — identified by having a box_2d array and found field
  for (const text of textParts) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.found !== undefined && Array.isArray(parsed.box_2d)) return parsed;
      }
    } catch (e) {}
  }
  return null;
}

function extractActorJSON(result) {
  const events = Array.isArray(result) ? result : result?.events;
  if (!events) return null;
  const textParts = events
    .filter(e => e.content && e.content.parts)
    .flatMap(e => e.content.parts)
    .filter(p => p.text)
    .map(p => p.text);
  // Find the actor's output — identified by having an "action" field
  for (const text of textParts) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.operation !== undefined && parsed.target !== undefined) return parsed;
      }
    } catch (e) {}
  }
  return null;
}