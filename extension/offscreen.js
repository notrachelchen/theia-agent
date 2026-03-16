// offscreen.js — runs in an offscreen document (has Web Audio API access)
// Receives base64 LINEAR16 PCM audio from the service worker and plays it.

let currentCtx    = null;
let currentSource = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'STOP_AUDIO') {
    stopCurrent();
    sendResponse();
    return true;
  }

  if (msg.type === 'PLAY_AUDIO') {
    stopCurrent();
    const mime = msg.mimeType || 'audio/pcm';
    const isPCM = mime.toLowerCase().includes('pcm') || mime.toLowerCase().includes('l16');
    console.log('[offscreen] PLAY_AUDIO mimeType=', mime, 'isPCM=', isPCM, 'base64 length=', msg.base64?.length);
    const play = isPCM
      ? playPCM(msg.base64, msg.sampleRate || 24000)
      : playEncoded(msg.base64, mime);
    play.then(() => { console.log('[offscreen] playback done'); sendResponse({ done: true }); })
        .catch(e => { console.error('[offscreen] playback error', e); sendResponse({ done: true }); });
    return true; // keep channel open for async response
  }
});

function stopCurrent() {
  if (currentSource) { try { currentSource.stop(); } catch (_) {} }
  if (currentCtx)    { currentCtx.close().catch(() => {}); }
  currentSource = null;
  currentCtx    = null;
}

async function playPCM(base64, sampleRate) {
  // Decode base64 → raw bytes
  const binary = atob(base64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // LINEAR16 = signed 16-bit little-endian integers → convert to Float32
  const samples = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) float32[i] = samples[i] / 32768;

  const ctx = new AudioContext({ sampleRate });
  currentCtx = ctx;

  const buffer = ctx.createBuffer(1, float32.length, sampleRate);
  buffer.copyToChannel(float32, 0);

  const source = ctx.createBufferSource();
  currentSource = source;
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();

  return new Promise(resolve => { source.onended = resolve; });
}

// For MP3, AAC, OGG etc. — let the browser decode it
async function playEncoded(base64, mimeType) {
  const binary = atob(base64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const ctx = new AudioContext();
  currentCtx = ctx;

  const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
  const source = ctx.createBufferSource();
  currentSource = source;
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  source.start();

  return new Promise(resolve => { source.onended = resolve; });
}
