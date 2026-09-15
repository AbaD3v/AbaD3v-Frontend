# Voxa

Voxa — голосовое пространство для практики языков. Пользователь говорит, получает ответ от AI и может разобрать свои ошибки в живом диалоге.

## Команда

- [Abzal M](https://github.com/AbaD3v) — основатель, lead developer
- [Ersultan K](https://github.com/ersultankargul07-alt)
- [Ayadil M](https://github.com/mukasevaadil2-cmd)
- [Rasul K](https://github.com/vancitygarfield)
- [Beibarys M](https://github.com/Terbarys)

## Что умеет Voxa

- голосовая практика в формате push-to-talk;
- распознавание речи на русском, английском и казахском;
- свободный чат для выбора темы прямо в диалоге;
- отдельные комнаты практики: собеседование, путешествия и повседневный разговор;
- проверка грамматики и персональный разбор после практики;
- озвучка ответов Voxa;
- выбор микрофона и языка;
- непрерывное слушание;
- история чатов с возможностью удаления;
- страница команды с GitHub-аватарками и интерактивным созвездием.

## Запуск frontend локально

```bash
npm install
npm run dev
```

Production-сборка:

```bash
npm run build
```

## Запуск backend локально

Перейди в папку `backend` и выполни:

```bash
uvicorn app.main:app --reload --port 8000
```

Backend использует FastAPI и связывает frontend с языковой моделью, распознаванием речи и синтезом голоса.

## Архитектура

```text
Vercel
  └── React/Vite frontend

Render
  └── FastAPI backend
      └── Gemini — текстовые ответы
      └── Hugging Face — Whisper STT + Silero TTS
```

## Бесплатный голосовой движок

Папка `hf_space` содержит Gradio Space для Hugging Face:

- `faster-whisper` — распознавание речи;
- Silero TTS — озвучка ответов;
- CPU-режим без обязательной ElevenLabs-квоты;
- Gradio API для подключения к Render.

Создай на Hugging Face Space типа **Gradio → Blank**. В корень Space нужно поместить содержимое папки `hf_space`.

На Render добавь переменные окружения:

```env
HF_VOICE_API_URL=https://<space-owner>-<space-name>.hf.space
HF_TTS_LANGUAGE=ru
```

Если `HF_VOICE_API_URL` указан, backend использует Hugging Face вместо ElevenLabs для распознавания и озвучки.

## Переменные backend

Скопируй пример настроек:

```text
backend/.env.example
```

Основные переменные:

```env
MOCK_MODE=false
GEMINI_API_KEY=твой_ключ
GEMINI_MODEL=gemini-3.5-flash-lite
HF_VOICE_API_URL=https://твой-space.hf.space
HF_TTS_LANGUAGE=ru
```

Секретные ключи не нужно добавлять во frontend или коммитить в GitHub.
