"""
Custom server entry point.
Wraps the ADK FastAPI app and adds a /tts proxy endpoint so the Chrome
extension never needs a hardcoded API key.

Run from the project root:
    uvicorn server:app --port 8000 --reload
"""

import asyncio
import base64
import json
import os
import textwrap
import traceback
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from google import genai
from google.genai import types as genai_types
from google.genai.errors import ServerError
from google.adk.cli.fast_api import get_fast_api_app

TTS_VOICE    = "Achernar"
TTS_MODEL    = "gemini-2.5-flash-preview-tts"
TTS_RETRIES  = 3

# Build the ADK app (equivalent to `adk api_server backend`)
_adk_app = get_fast_api_app(
    agent_dir=str(Path(__file__).parent / "backend"),
    web=False,
    allow_origins=["*"],
)


# ── helpers ──────────────────────────────────────────────────────────────────

async def _send_json(send, data: dict, status: int = 200):
    body = json.dumps(data).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            [b"content-type", b"application/json"],
            [b"content-length", str(len(body)).encode()],
        ],
    })
    await send({"type": "http.response.body", "body": body})


def _log_events(events: list):
    """Print a readable trace of agent reasoning from an ADK /run response."""
    print("\n" + "═" * 60)
    for event in events:
        author  = event.get("author", "?")
        content = event.get("content") or {}
        parts   = content.get("parts") or []
        for part in parts:
            if "text" in part and part["text"]:
                snippet = textwrap.shorten(part["text"], width=300, placeholder="…")
                print(f"  [{author}] {snippet}")
            elif "function_call" in part:
                fc   = part["function_call"]
                args = json.dumps(fc.get("args", {}), ensure_ascii=False)
                args = textwrap.shorten(args, width=200, placeholder="…")
                print(f"  [{author}] → CALL {fc['name']}({args})")
            elif "function_response" in part:
                fr   = part["function_response"]
                resp = json.dumps(fr.get("response", {}), ensure_ascii=False)
                resp = textwrap.shorten(resp, width=200, placeholder="…")
                print(f"  [{author}] ← {fr['name']} = {resp}")
    print("═" * 60 + "\n")


# ── /tts handler ─────────────────────────────────────────────────────────────

async def _handle_tts(scope, receive, send):
    chunks, more = [], True
    while more:
        msg = await receive()
        chunks.append(msg.get("body", b""))
        more = msg.get("more_body", False)

    try:
        body = json.loads(b"".join(chunks))
        text = body.get("text", "")
    except Exception:
        await _send_json(send, {"error": "Invalid JSON body"}, 400)
        return

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        await _send_json(send, {"error": "GOOGLE_API_KEY not set in .env"}, 500)
        return

    client = genai.Client(api_key=api_key)
    last_error = None

    for attempt in range(1, TTS_RETRIES + 1):
        try:
            response = await client.aio.models.generate_content(
                model=TTS_MODEL,
                contents=text,
                config=genai_types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=genai_types.SpeechConfig(
                        voice_config=genai_types.VoiceConfig(
                            prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                                voice_name=TTS_VOICE
                            )
                        )
                    ),
                ),
            )
            part     = response.candidates[0].content.parts[0]
            audio_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
            mime      = part.inline_data.mime_type or "audio/pcm"
            print(f"[TTS] OK (attempt {attempt}) — mimeType={mime!r}  bytes={len(part.inline_data.data)}")
            await _send_json(send, {"audioContent": audio_b64, "mimeType": mime})
            return
        except ServerError as e:
            last_error = e
            if attempt < TTS_RETRIES:
                print(f"[TTS] 500 from Google (attempt {attempt}/{TTS_RETRIES}), retrying in 1s…")
                await asyncio.sleep(1)
        except Exception as e:
            print(f"[TTS] unexpected error:\n{traceback.format_exc()}")
            await _send_json(send, {"error": str(e)}, 500)
            return

    print(f"[TTS] all {TTS_RETRIES} attempts failed: {last_error}")
    await _send_json(send, {"error": str(last_error)}, 500)


# ── ASGI wrapper ─────────────────────────────────────────────────────────────

class _CaptureSend:
    """Wraps the ASGI send callable to capture the response body for logging."""
    def __init__(self, send):
        self._send  = send
        self.body   = b""
        self.status = 200

    async def __call__(self, message):
        if message["type"] == "http.response.start":
            self.status = message.get("status", 200)
        elif message["type"] == "http.response.body":
            self.body += message.get("body", b"")
        await self._send(message)


class TTSApp:
    """Pure ASGI wrapper — handles /tts, logs /run events, passes rest to ADK."""

    def __init__(self, adk_app):
        self._adk = adk_app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self._adk(scope, receive, send)
            return

        path   = scope.get("path", "")
        method = scope.get("method", "")

        if method == "POST" and path == "/tts":
            await _handle_tts(scope, receive, send)

        elif method == "POST" and path == "/run":
            # Let ADK handle it but capture the response for logging
            capture = _CaptureSend(send)
            await self._adk(scope, receive, capture)
            if capture.status == 200 and capture.body:
                try:
                    events = json.loads(capture.body)
                    if isinstance(events, list):
                        _log_events(events)
                except Exception:
                    pass

        else:
            await self._adk(scope, receive, send)


app = TTSApp(_adk_app)
