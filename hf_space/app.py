import os
from functools import lru_cache

import gradio as gr
import soundfile as sf
import torch
from faster_whisper import WhisperModel

torch.set_num_threads(2)


@lru_cache(maxsize=1)
def whisper_model() -> WhisperModel:
    # CTranslate2's CUDA runtime is not guaranteed in ZeroGPU containers.
    # CPU int8 is slower but works reliably without libcublas.so.12.
    return WhisperModel(os.getenv("WHISPER_MODEL", "base"), device="cpu", compute_type="int8")


@lru_cache(maxsize=2)
def silero_model(language: str):
    if language == "en":
        return torch.hub.load("snakers4/silero-models", "silero_tts", language="en", speaker="lj_16khz", trust_repo=True)[0]
    return torch.hub.load("snakers4/silero-models", "silero_tts", language="ru", speaker="v5_ru", trust_repo=True)[0]


def transcribe(audio_path: str, language: str = "ru") -> str:
    if not audio_path:
        return ""
    language = language if language in {"ru", "en", "kk"} else "ru"
    segments, _ = whisper_model().transcribe(audio_path, language=language, vad_filter=True)
    return " ".join(segment.text.strip() for segment in segments).strip()


def synthesize(text: str, language: str = "ru"):
    language = language if language in {"ru", "en"} else "ru"
    model = silero_model(language)
    speaker = "xenia" if language == "ru" else "lj"
    audio = model.apply_tts(text=text[:1200], speaker=speaker, sample_rate=48000)
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
