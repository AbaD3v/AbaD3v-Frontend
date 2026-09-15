import io
import os
import wave
from functools import lru_cache

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from faster_whisper import WhisperModel

app = FastAPI(title="Voxa Voice Engine")


@lru_cache(maxsize=1)
def get_whisper() -> WhisperModel:
    model_name = os.getenv("WHISPER_MODEL", "base")
    return WhisperModel(model_name, device="cpu", compute_type="int8")


@lru_cache(maxsize=4)
def get_silero(language: str):
    language = language if language in {"ru", "en"} else "ru"
    model, _ = torch.hub.load(
        repo_or_dir="snakers4/silero-models",
        model="silero_tts",
        language=language,
        speaker="v5_ru" if language == "ru" else "lj_16khz",
    )
    return model


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), language: str = Form("ru")) -> dict[str, str]:
    payload = await audio.read()
    if not payload:
        raise HTTPException(400, "Audio file is empty")
    language = language if language in {"ru", "en", "kk"} else "ru"
    segments, _ = get_whisper().transcribe(io.BytesIO(payload), language=language, vad_filter=True)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if not text:
        raise HTTPException(422, "No speech detected")
    return {"text": text}


@app.post("/synthesize")
async def synthesize(text: str = Form(...), language: str = Form("ru")) -> Response:
    if not text.strip():
        raise HTTPException(400, "Text is empty")
    language = language if language in {"ru", "en"} else "ru"
    model = get_silero(language)
    speaker = "xenia" if language == "ru" else "lj"
    audio = model.apply_tts(text=text[:1200], speaker=speaker, sample_rate=48000)
    buffer = io.BytesIO()
    sf.write(buffer, audio.detach().cpu().numpy(), 48000, format="WAV", subtype="PCM_16")
    return Response(content=buffer.getvalue(), media_type="audio/wav")
