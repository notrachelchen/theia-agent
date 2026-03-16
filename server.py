"""
Custom server entry point.
Wraps the ADK FastAPI app and adds a /tts proxy endpoint so the Chrome
extension never needs a hardcoded API key.

Run from the project root:
    uvicorn server:app --port 8000 --reload
"""

import base64
import json
import os
import traceback
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from google import genai
from google.genai import types as genai_types
from google.adk.cli.fast_api import get_fast_api_app

TTS_VOICE = "Achernar"
TTS_MODEL = "gemini-2.5-flash-preview-tts"

# Build the ADK app (equivalent to `adk api_server backend`)
_adk_app = get_fast_api_app(
    agent_dir=str(Path(__file__).parent / "backend"),
    web=False,
    allow_origins=["*"],
)


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


async def _handle_tts(scope, receive, send):
    # Read request body
    chunks = []
    more = True
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

    try:
        client = genai.Client(api_key=api_key)
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
        part = response.candidates[0].content.parts[0]
        audio_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
        mime = part.inline_data.mime_type or "audio/pcm"
        print(f"[TTS] OK — mimeType={mime!r}  bytes={len(part.inline_data.data)}")
        await _send_json(send, {
            "audioContent": audio_b64,
            "mimeType": mime,
        })
    except Exception as e:
        print(f"[TTS] error: {traceback.format_exc()}")
        await _send_json(send, {"error": str(e)}, 500)


class TTSApp:
    """Pure ASGI wrapper — intercepts POST /tts, passes everything else to ADK."""

    def __init__(self, adk_app):
        self._adk = adk_app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] == "http"
            and scope.get("method") == "POST"
            and scope.get("path") == "/tts"
        ):
            await _handle_tts(scope, receive, send)
        else:
            await self._adk(scope, receive, send)


app = TTSApp(_adk_app)
