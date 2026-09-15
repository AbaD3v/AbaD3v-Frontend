import os
import tempfile
from functools import lru_cache

import gradio as gr
import numpy as np
import soundfile as sf
import torch
import spaces
from faster_whisper import WhisperModel
from scipy.signal import resample_poly

torch.set_num_threads(2)


@spaces.GPU(duration=1)
def zero_gpu_marker() -> str:
    """Keep ZeroGPU Spaces happy while inference remains CPU-based."""
    return "ready"


@lru_cache(maxsize=1)
def whisper_model() -> WhisperModel:
    # CTranslate2's CUDA runtime is not guaranteed in ZeroGPU containers.
    # CPU int8 is slower but works reliably without libcublas.so.12.
    return WhisperModel(os.getenv("WHISPER_MODEL", "small"), device="cpu", compute_type="int8")


@lru_cache(maxsize=2)
def silero_model(language: str):
    if language == "en":
        return torch.hub.load("snakers4/silero-models", "silero_tts", language="en", speaker="lj_16khz", trust_repo=True)[0]
    return torch.hub.load("snakers4/silero-models", "silero_tts", language="ru", speaker="v5_ru", trust_repo=True)[0]


def clean_transcript(text: str) -> str:
    words = text.split()
    if len(words) < 8:
        return text
    normalized = [word.lower().strip(".,!?;:()[]{}\"'") for word in words]
    longest_run = 1
    current_run = 1
    for index in range(1, len(normalized)):
        if normalized[index] == normalized[index - 1]:
            current_run += 1
            longest_run = max(longest_run, current_run)
        else:
            current_run = 1
    if longest_run >= 5:
        return ""
    compact = "".join(normalized).replace("-", "")
    if len(compact) > 12 and len(set(normalized)) <= 3:
        return ""
    return text


def transcribe(audio_path: str, language: str = "ru") -> str:
    if not audio_path:
        return ""
    language = language if language in {"ru", "en", "kk"} else "ru"
    prepared_path = audio_path
    temporary_path = ""
    try:
        # Normalize browser WAV recordings to the format Whisper handles best.
        samples, sample_rate = sf.read(audio_path, dtype="float32")
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
        if peak > 0.01:
            samples = np.clip(samples * min(0.95 / peak, 2.5), -1.0, 1.0)
        if sample_rate != 16000:
            samples = resample_poly(samples, 16000, sample_rate).astype(np.float32)
        rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
        if rms < 0.003:
            return ""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output:
            sf.write(output.name, samples, 16000, subtype="PCM_16")
            temporary_path = output.name
            prepared_path = output.name
    except Exception:
        # Keep support for formats soundfile cannot decode, such as WebM.
        prepared_path = audio_path

    segments, _ = whisper_model().transcribe(
        prepared_path,
        language=language,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 180, "speech_pad_ms": 220},
        condition_on_previous_text=False,
        beam_size=5,
        temperature=0,
        no_speech_threshold=0.55,
        log_prob_threshold=-1.0,
        compression_ratio_threshold=2.2,
        repetition_penalty=1.1,
    )
    text = clean_transcript(" ".join(segment.text.strip() for segment in segments).strip())
    if temporary_path:
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
    return text


def synthesize(text: str, language: str = "ru"):
    language = language if language in {"ru", "en"} else "ru"
    model = silero_model(language)
    speaker = "xenia" if language == "ru" else "lj"
    # Silero's FastPitch positional encoding breaks above ~1000 characters.
    # Keep a safe limit for long practice reports and preserve a complete prefix.
    safe_text = text.strip()[:850]
    audio = model.apply_tts(text=safe_text, speaker=speaker, sample_rate=48000)
    output = "/tmp/voxa-response.wav"
    sf.write(output, audio.detach().cpu().numpy(), 48000, format="WAV", subtype="PCM_16")
    return output


with gr.Blocks(title="Voxa Voice Engine") as demo:
    gr.Markdown("# Voxa Voice Engine\nFree Whisper STT and Silero TTS for Voxa.")
    with gr.Row():
        audio = gr.Audio(type="filepath", label="Audio")
        language = gr.Dropdown(["ru", "en", "kk"], value="ru", label="Language")
    transcript = gr.Textbox(label="Transcript")
    gr.Button("Transcribe").click(transcribe, [audio, language], transcript, api_name="transcribe")
    text = gr.Textbox(label="Text to speak")
    output_audio = gr.Audio(label="Speech")
    gr.Button("Synthesize").click(synthesize, [text, language], output_audio, api_name="synthesize")


demo.launch(ssr_mode=False)
