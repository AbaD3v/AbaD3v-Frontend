# Наш проект

Участники:
- [Abzal M](https://github.com/AbaD3v)
- [Ersultan K](https://github.com/ersultankargul07-alt)
- [Ayadil M](https://github.com/mukasevaadil2-cmd)
- [Rasul K](https://github.com/vancitygarfield)
- [Beibarys M](https://github.com/Terbarys)

## Voxa — voice practice MVP

Frontend MVP for a voice-first language practice room.

### Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

### Included

- Responsive practice-room UI with scenario switching.
- Push-to-talk recording through `getUserMedia` + `MediaRecorder`.
- Continuous-listening toggle, voice waveform, playback state, and grammar feedback.
- Local response stub ready to be replaced by a FastAPI STT → LLM → TTS endpoint.

### Free voice engine (Hugging Face)

The `hf_space` directory contains a Docker Space with `faster-whisper` and Silero TTS.
Create a Docker Space on Hugging Face, copy the contents of `hf_space` into it, then
set `HF_VOICE_API_URL=https://<space-owner>-<space-name>.hf.space` on the Render backend.
Set `HF_TTS_LANGUAGE=ru` for the current Russian voice path. When `HF_VOICE_API_URL`
is set, Render uses the Space instead of ElevenLabs for STT and TTS.
