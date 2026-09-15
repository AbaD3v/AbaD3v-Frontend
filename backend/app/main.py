import base64
import asyncio
import io
import json
import os
import tempfile
from functools import lru_cache
from typing import Any
import wave

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from gradio_client import Client, handle_file

load_dotenv()

app = FastAPI(title="Voxa API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SCENARIOS = {
    "job-interview": "You are a friendly recruiter interviewing a software developer.",
    "hotel-check-in": "You are a hotel receptionist helping a guest check in.",
    "coffee-catch-up": "You are a friend having a relaxed conversation over coffee.",
}
LANGUAGE_NAMES = {"en": "English", "ru": "Russian", "kk": "Kazakh"}
STT_LANGUAGE_CODES = {"en": "eng", "ru": "rus", "kk": "kaz"}


def hf_voice_api_url() -> str:
    return os.getenv("HF_VOICE_API_URL", "").strip().rstrip("/")


@lru_cache(maxsize=2)
def hf_client(space_url: str) -> Client:
    return Client(space_url)


async def hf_transcribe(space_url: str, payload: bytes, mime_type: str, language: str) -> str:
    suffix = ".webm" if "webm" in mime_type else ".wav"
    temporary_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary_file:
            temporary_file.write(payload)
            temporary_path = temporary_file.name
        result = await asyncio.to_thread(
            lambda: hf_client(space_url).predict(
                handle_file(temporary_path), language or "ru", api_name="/transcribe"
            )
        )
        return str(result or "").strip()
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


async def hf_synthesize(space_url: str, text: str, language: str) -> bytes:
    result = await asyncio.to_thread(
        lambda: hf_client(space_url).predict(text, language, api_name="/synthesize")
    )
    output_path = result.get("path") if isinstance(result, dict) else str(result)
    if not output_path or not os.path.exists(output_path):
        raise RuntimeError("Hugging Face returned no audio file")
    with open(output_path, "rb") as audio_file:
        return audio_file.read()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/voices")
async def voices() -> dict[str, Any]:
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if os.getenv("MOCK_MODE", "true").lower() == "true":
        return {"voices": [{"voice_id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah", "category": "premade"}]}
    if not api_key:
        raise HTTPException(500, "ELEVENLABS_API_KEY is not configured")
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get("https://api.elevenlabs.io/v2/voices", headers={"xi-api-key": api_key})
    if response.status_code == 429:
        raise HTTPException(429, "ElevenLabs voice-list quota or rate limit exceeded.")
    response.raise_for_status()
    return {"voices": [{"voice_id": item["voice_id"], "name": item["name"], "category": item.get("category")} for item in response.json().get("voices", [])]}


def mock_result() -> dict[str, Any]:
    return {
        "transcript": "I would begin by understanding the user needs and then test the first version quickly.",
        "correction": None,
        "reply": "That is a thoughtful approach. How would you measure whether the solution was successful?",
        "audio_base64": None,
        "audio_content_type": None,
    }


def parse_json_text(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(cleaned)


def extract_transcript(data: dict[str, Any]) -> str:
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    text_parts: list[str] = []
    for part in parts:
        if isinstance(part.get("text"), str) and part["text"].strip():
            text_parts.append(part["text"].strip())
        transcription = part.get("audioTranscription") or part.get("audio_transcription")
        if isinstance(transcription, dict):
            if isinstance(transcription.get("text"), str) and transcription["text"].strip():
                text_parts.append(transcription["text"].strip())
            elif isinstance(transcription.get("words"), list):
                text_parts.append(" ".join(word.get("word", "") for word in transcription["words"]).strip())
    return " ".join(text_parts).strip()


def wav_diagnostics(payload: bytes) -> str:
    try:
        with wave.open(io.BytesIO(payload), "rb") as audio:
            frames = audio.readframes(audio.getnframes())
            duration = audio.getnframes() / audio.getframerate()
            # `audioop` was removed from Python 3.13+. Diagnostics are not
            # part of the transcription path, so keep this portable and do
            # not make the whole API depend on that deprecated stdlib module.
            return f"WAV diagnostics: {duration:.2f}s, {audio.getframerate()}Hz"
    except (wave.Error, EOFError):
        return "Audio diagnostics unavailable (not a valid WAV file)"


async def process_audio_with_gemini(payload: bytes, mime_type: str, scenario: str, language: str) -> dict[str, Any]:
    transcript = await transcribe_with_elevenlabs(payload, mime_type, language)
    reply = await generate_reply_with_gemini(transcript, scenario, language)
    return {"transcript": transcript, **reply}


async def transcribe_with_elevenlabs(payload: bytes, mime_type: str, language: str | None) -> str:
    voice_api_url = hf_voice_api_url()
    if voice_api_url:
        try:
            transcript = await hf_transcribe(voice_api_url, payload, mime_type, language or "ru")
        except Exception as error:
            raise HTTPException(502, f"Hugging Face STT error: {error}") from error
        if not transcript:
            raise HTTPException(502, "Hugging Face returned no transcript")
        return transcript

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(500, "ELEVENLABS_API_KEY is not configured")

    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": api_key},
            files={"file": ("recording.wav", payload, mime_type)},
            data={"model_id": "scribe_v2", "tag_audio_events": "false", **({"language_code": STT_LANGUAGE_CODES[language]} if language in STT_LANGUAGE_CODES else {})},
        )

    if response.status_code in {401, 403}:
        try:
            provider_error = response.json().get("detail", response.text[:300])
        except ValueError:
            provider_error = response.text[:300]
        print(f"ElevenLabs STT rejected request ({response.status_code}): {provider_error}")
        if isinstance(provider_error, dict) and provider_error.get("code") == "quota_exceeded":
            raise HTTPException(429, "Закончилась квота ElevenLabs Speech to Text: доступно 0 кредитов. Пополни квоту или подключи локальное распознавание.")
        if response.status_code == 401:
            raise HTTPException(401, "ElevenLabs key works for Voices, but Speech to Text is not authorized for it. Enable Speech to Text → Access or create a new key with that permission.")
        raise HTTPException(403, f"ElevenLabs rejected Speech to Text. Enable Speech to Text → Access and check STT quota. Details: {provider_error}")
    if response.status_code == 429:
        raise HTTPException(429, "ElevenLabs speech-to-text quota or rate limit exceeded.")
    response.raise_for_status()
    transcript = str(response.json().get("text", "")).strip()
    if not transcript:
        raise HTTPException(502, "ElevenLabs returned no transcript. Please record a longer answer and try again.")
    return transcript


async def generate_reply_with_gemini(transcript: str, scenario: str, language: str, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(500, "GEMINI_API_KEY is not configured")
    conversation_context = "\n".join(f"{item.get('role', 'user')}: {item.get('text', '')}" for item in (history or [])[-12:])
    reply_body = {
        "system_instruction": {"parts": [{"text": f"""{SCENARIOS.get(scenario, SCENARIOS['job-interview'])}
Answer in {LANGUAGE_NAMES.get(language, 'English')}. Continue the conversation naturally and ask exactly one concise follow-up question based on the previous answers. Never repeat a question that was already asked. Analyze the user's grammar, but do not change their transcript.
Return JSON only: {{\"reply\": string, \"correction\": null | {{\"original\": string, \"suggestion\": string, \"explanation\": string}} }}"""}]},
        "contents": [{"parts": [{"text": f"Conversation so far:\n{conversation_context}\n\nLatest user answer:\n{transcript}"}]}],
        "generationConfig": {"temperature": 0.4, "responseMimeType": "application/json"},
    }
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    if gemini_model in {"gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"}:
        gemini_model = "gemini-3.5-flash-lite"
    async with httpx.AsyncClient(timeout=60) as client:
        reply_response = None
        for attempt in range(3):
            reply_response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent",
                headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                json=reply_body,
            )
            if reply_response.status_code != 503:
                break
            await asyncio.sleep(1.5 * (attempt + 1))
        assert reply_response is not None
    if reply_response.status_code == 503:
        raise HTTPException(503, "Gemini is temporarily unavailable. Please try again in a moment.")
    if reply_response.status_code == 429:
        raise HTTPException(429, "Gemini free-tier quota or rate limit exceeded.")
    reply_response.raise_for_status()
    try:
        reply = parse_json_text(reply_response.json()["candidates"][0]["content"]["parts"][0]["text"])
    except (KeyError, IndexError, json.JSONDecodeError) as error:
        raise HTTPException(502, "Gemini returned an invalid JSON reply. Try a shorter recording.") from error
    return {"transcript": transcript, **reply}


async def generate_setup_welcome() -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"reply": "Привет! Что хочешь потренировать сегодня: собеседование, путешествие или обычный разговор?", "chat_title": "Новый чат"}
    setup_prompt = """You are Voxa, a warm voice-practice coach. Start a new practice room.
Ask one natural, short question in Russian that invites the user to describe what they want to practice.
Do not use a fixed list or sound like a form. Return JSON only: {\"reply\": string, \"chat_title\": \"Новый чат\"}."""
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    if gemini_model in {"gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"}:
        gemini_model = "gemini-3.5-flash-lite"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent",
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json={"system_instruction": {"parts": [{"text": setup_prompt}]}, "contents": [{"parts": [{"text": "Begin."}]}], "generationConfig": {"temperature": 0.8, "responseMimeType": "application/json"}},
        )
    if response.status_code == 429:
        raise HTTPException(429, "Gemini free-tier quota or rate limit exceeded.")
    response.raise_for_status()
    try:
        return parse_json_text(response.json()["candidates"][0]["content"]["parts"][0]["text"])
    except (KeyError, IndexError, json.JSONDecodeError) as error:
        raise HTTPException(502, "Gemini returned an invalid setup message.") from error


@app.post("/api/session/start")
async def session_start(voice_id: str | None = Form(None)) -> dict[str, Any]:
    if os.getenv("MOCK_MODE", "true").lower() == "true":
        reply = "Привет! Что хочешь потренировать сегодня?"
        audio_base64, content_type = await synthesize(reply, voice_id)
        return {"chat_title": "Новый чат", "reply": reply, "audio_base64": audio_base64, "audio_content_type": content_type}
    result = await generate_setup_welcome()
    audio_base64, content_type = await synthesize(result.get("reply", ""), voice_id)
    return {**result, "audio_base64": audio_base64, "audio_content_type": content_type}


async def gemini_json(prompt: str, user_text: str) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(500, "GEMINI_API_KEY is not configured")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    if gemini_model in {"gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"}:
        gemini_model = "gemini-3.5-flash-lite"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent",
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json={"system_instruction": {"parts": [{"text": prompt}]}, "contents": [{"parts": [{"text": user_text}]}], "generationConfig": {"temperature": 0.6, "responseMimeType": "application/json"}},
        )
    if response.status_code == 429:
        raise HTTPException(429, "Gemini free-tier quota or rate limit exceeded.")
    response.raise_for_status()
    try:
        return parse_json_text(response.json()["candidates"][0]["content"]["parts"][0]["text"])
    except (KeyError, IndexError, json.JSONDecodeError) as error:
        raise HTTPException(502, "Gemini returned an invalid structured response.") from error


@app.post("/api/session/open")
async def session_open(scenario: str = Form("job-interview"), language: str = Form("ru"), voice_id: str | None = Form(None)) -> dict[str, Any]:
    prompt = f"""You are Voxa conducting a {SCENARIOS.get(scenario, SCENARIOS['job-interview'])}.
Speak in {LANGUAGE_NAMES.get(language, 'Russian')}. The practice has just started.
Greet the learner naturally, briefly explain the role, and ask the first logical question. Ask exactly one question.
Return JSON only: {{\"reply\": string}}."""
    result = await gemini_json(prompt, "Start the practice room now.")
    reply = result.get("reply", "Начнём. Расскажи немного о себе.")
    audio_base64, content_type = await synthesize(reply, voice_id)
    return {"reply": reply, "audio_base64": audio_base64, "audio_content_type": content_type}


@app.post("/api/session/evaluate")
async def session_evaluate(
    scenario: str = Form("job-interview"),
    language: str = Form("ru"),
    history: str = Form("[]"),
    voice_id: str | None = Form(None),
) -> dict[str, Any]:
    prompt = f"""You are Voxa, a demanding but supportive coach. Review a completed {SCENARIOS.get(scenario, SCENARIOS['job-interview'])}.
Write the feedback in {LANGUAGE_NAMES.get(language, 'Russian')}.
Use the actual answers from the transcript. Be specific: mention what was strong, what to improve, and give one better example answer.
Return JSON only: {{\"summary\": string, \"strengths\": [string], \"improvements\": [string], \"better_answer\": string}}."""
    try:
        history_items = json.loads(history)
    except json.JSONDecodeError:
        history_items = []
    result = await gemini_json(prompt, json.dumps(history_items[-30:], ensure_ascii=False))
    strengths = "\n".join(f"• {item}" for item in result.get("strengths", []))
    improvements = "\n".join(f"• {item}" for item in result.get("improvements", []))
    reply = f"{result.get('summary', '')}\n\nСильные стороны:\n{strengths}\n\nЧто улучшить:\n{improvements}\n\nПример более сильного ответа:\n{result.get('better_answer', '')}".strip()
    audio_base64, content_type = await synthesize(reply, voice_id)
    return {"reply": reply, "audio_base64": audio_base64, "audio_content_type": content_type}


async def transcribe_legacy(audio: UploadFile, payload: bytes) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "OPENAI_API_KEY is not configured")
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (audio.filename or "recording.webm", payload, audio.content_type or "audio/webm")},
            data={"model": "whisper-1", "response_format": "json"},
        )
    if response.status_code == 429:
        raise HTTPException(429, "OpenAI Whisper quota or rate limit exceeded.")
    response.raise_for_status()
    return response.json()["text"]


async def generate_reply_legacy(transcript: str, scenario: str) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    system = f"""{SCENARIOS.get(scenario, SCENARIOS['job-interview'])}
Ask exactly one concise follow-up question and wait for the user's next answer.
Return JSON only with this schema:
{{\"reply\": string, \"correction\": null | {{\"original\": string, \"suggestion\": string, \"explanation\": string}} }}
If the transcript has no meaningful grammar error, correction must be null."""
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                "temperature": 0.4,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": transcript}],
            },
        )
    if response.status_code == 429:
        raise HTTPException(429, "OpenAI LLM quota or rate limit exceeded.")
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return json.loads(content)


async def synthesize(text: str, voice_id: str | None) -> tuple[str | None, str | None]:
    voice_api_url = hf_voice_api_url()
    if voice_api_url:
        try:
            audio_bytes = await hf_synthesize(voice_api_url, text, os.getenv("HF_TTS_LANGUAGE", "ru"))
        except Exception as error:
            print(f"Hugging Face TTS error: {error}")
            return None, None
        return base64.b64encode(audio_bytes).decode("ascii"), "audio/wav"

    api_key = os.getenv("ELEVENLABS_API_KEY")
    voice_id = voice_id or os.getenv("ELEVENLABS_VOICE_ID")
    if not api_key or not voice_id:
        return None, None
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={"xi-api-key": api_key, "accept": "audio/mpeg", "Content-Type": "application/json"},
            json={"text": text, "model_id": "eleven_multilingual_v2"},
        )
    if response.status_code in {401, 403}:
        fallback_voice = os.getenv("ELEVENLABS_VOICE_ID")
        if fallback_voice and voice_id != fallback_voice:
            print(f"Falling back to default ElevenLabs voice: {fallback_voice}")
            return await synthesize(text, fallback_voice)
        print(f"ElevenLabs voice is not available for this API key: {voice_id}")
        return None, None
    if response.status_code == 429:
        print("ElevenLabs text-to-speech quota or rate limit exceeded")
        return None, None
    response.raise_for_status()
    return base64.b64encode(response.content).decode("ascii"), "audio/mpeg"


@app.post("/api/session/turn")
async def session_turn(
    audio: UploadFile = File(...),
    scenario: str = Form("job-interview"),
    language: str = Form("ru"),
    voice_id: str | None = Form(None),
    mode: str = Form("practice"),
    history: str = Form("[]"),
    transcript_override: str | None = Form(None),
) -> dict[str, Any]:
    if language not in LANGUAGE_NAMES:
        language = "en"
    payload = await audio.read()
    if not payload:
        raise HTTPException(400, "Audio file is empty")
    print(wav_diagnostics(payload))
    if os.getenv("MOCK_MODE", "true").lower() == "true":
        return mock_result()
    try:
        history_items = json.loads(history)
    except json.JSONDecodeError:
        history_items = []
    transcript = transcript_override.strip() if transcript_override and transcript_override.strip() else await transcribe_with_elevenlabs(payload, audio.content_type or "audio/webm", language if mode != "setup" else None)
    if mode == "setup":
        setup_body = {
            "system_instruction": {"parts": [{"text": """You are Voxa, a warm voice-practice coach. The user is configuring a new practice room.
Understand their desired situation, whether it is an interview or role-play, the role/topic, target language, and optionally difficulty.
If important information is missing, ask exactly one natural follow-up question and keep chat_title as \"Новый чат\".
When enough is known, create a short clear title in the user's language (2–5 words), choose language as one of en, ru, kk, and warmly tell the user that the room is ready and offer to move there. Do not start the practice question yet; that happens only after the user presses Start.
Return JSON only: {\"reply\": string, \"chat_title\": string, \"language\": \"en\"|\"ru\"|\"kk\", \"scenario\": \"job-interview\"|\"hotel-check-in\"|\"coffee-catch-up\", \"ready\": boolean}."""}]},
            "contents": [{"parts": [{"text": f"Previous setup conversation:\n{json.dumps(history_items[-8:], ensure_ascii=False)}\n\nUser says:\n{transcript}"}]}],
            "generationConfig": {"temperature": 0.7, "responseMimeType": "application/json"},
        }
        api_key = os.getenv("GEMINI_API_KEY")
        gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
        if gemini_model in {"gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"}:
            gemini_model = "gemini-3.5-flash-lite"
        async with httpx.AsyncClient(timeout=60) as client:
            setup_response = await client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent", headers={"x-goog-api-key": api_key, "Content-Type": "application/json"}, json=setup_body)
        if setup_response.status_code == 429:
            raise HTTPException(429, "Gemini free-tier quota or rate limit exceeded.")
        setup_response.raise_for_status()
        try:
            setup_result = parse_json_text(setup_response.json()["candidates"][0]["content"]["parts"][0]["text"])
        except (KeyError, IndexError, json.JSONDecodeError) as error:
            raise HTTPException(502, "Gemini returned an invalid practice setup.") from error
        audio_base64, content_type = await synthesize(setup_result.get("reply", ""), voice_id)
        return {"transcript": transcript, **setup_result, "correction": None, "audio_base64": audio_base64, "audio_content_type": content_type}
    response = await generate_reply_with_gemini(transcript, scenario, language, history_items)
    audio_base64, content_type = await synthesize(response["reply"], voice_id)
    return {**response, "audio_base64": audio_base64, "audio_content_type": content_type}
