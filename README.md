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
