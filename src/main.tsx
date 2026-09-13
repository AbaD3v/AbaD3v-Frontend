import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, BarChart3, Check, ChevronDown, CircleHelp, Headphones, LayoutGrid, Mic, Pause, Play, RotateCcw, Settings2, Sparkles, Volume2, X } from 'lucide-react';
import './styles.css';

type Correction = { original: string; suggestion: string; explanation: string };
type Message = { role: 'ai' | 'you'; text: string; time: string; correction?: Correction | null };
type Voice = { voice_id: string; name: string; category?: string };
type InputDevice = { deviceId: string; label: string };
type Chat = { id: string; title: string; createdAt: number; messages: Message[]; language: Language; scenario: number; phase: Phase; kind: 'planner' | 'practice'; sourceId?: string; started: boolean };
type Phase = 'setup' | 'practice';
type Language = 'en' | 'ru' | 'kk';
type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };

const languages: { value: Language; label: string; code: string }[] = [
  { value: 'ru', label: 'Русский', code: 'rus' },
  { value: 'en', label: 'English', code: 'eng' },
  { value: 'kk', label: 'Қазақша', code: 'kaz' },
];

const scenarios = [
  { id: 'job-interview', title: 'IT-собеседование', meta: 'Разработчик · English', icon: '✦' },
  { id: 'hotel-check-in', title: 'Заселение в отель', meta: 'Путешествие · English', icon: '⌂' },
  { id: 'coffee-catch-up', title: 'Разговор за кофе', meta: 'Неформальное общение', icon: '☕' },
];

const welcomeTexts: Record<Language, string> = {
  en: "Hi Alex, welcome. Let's start with a classic one: could you tell me about a project you're particularly proud of?",
  ru: 'Привет, Алекс! Начнём с классического вопроса: расскажи о проекте, которым ты особенно гордишься.',
  kk: 'Сәлем, Алекс! Классикалық сұрақтан бастайық: өзің ерекше мақтан тұтатын жоба туралы айтып бере аласың ба?',
};
const currentTime = () => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date());
const createWelcomeMessage = (language: Language): Message => ({ role: 'ai', text: welcomeTexts[language], time: currentTime() });
const API_URL = import.meta.env.VITE_API_URL;

function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2); const view = new DataView(buffer);
  const write = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44; chunks.forEach((chunk) => chunk.forEach((sample) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true); offset += 2; }));
  return new Blob([buffer], { type: 'audio/wav' });
}

function signalLevel(chunks: Float32Array[]) {
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (!samples) return 0;
  const energy = chunks.reduce((total, chunk) => total + chunk.reduce((sum, sample) => sum + sample * sample, 0), 0);
  return Math.sqrt(energy / samples);
}

function App() {
  const [scenario, setScenario] = useState(0);
  const [language, setLanguage] = useState<Language>('ru');
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>('setup');
  const [chats, setChats] = useState<Chat[]>([{ id: 'chat-1', title: 'Новый чат', createdAt: Date.now(), messages: [], language: 'ru', scenario: 0, phase: 'setup', kind: 'planner', started: false }]);
  const [activeChatId, setActiveChatId] = useState('chat-1');
  const [pendingRoom, setPendingRoom] = useState<Chat | null>(null);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showScenarioMenu, setShowScenarioMenu] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('EXAVITQu4vr4xnSDxMaL');
  const [inputDevices, setInputDevices] = useState<InputDevice[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState('');
  const [status, setStatus] = useState('Готово к началу');
  const [clientTranscript, setClientTranscript] = useState('');
  const [browserSpeechAvailable, setBrowserSpeechAvailable] = useState(true);
  const audioContext = useRef<AudioContext | null>(null);
  const audioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessor = useRef<ScriptProcessorNode | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const pcmChunks = useRef<Float32Array[]>([]);
  const speechRecognition = useRef<SpeechRecognitionLike | null>(null);
  const clientTranscriptRef = useRef('');
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const recordingStartedAt = useRef(0);
  const hadVoiceSignal = useRef(false);
  const recordingRef = useRef(false);

  useEffect(() => () => { audioProcessor.current?.disconnect(); audioSource.current?.disconnect(); audioStream.current?.getTracks().forEach((track) => track.stop()); void audioContext.current?.close(); }, []);
  useEffect(() => {
    if (!API_URL) return;
    fetch(`${API_URL}/api/voices`).then((response) => response.json()).then((data) => setVoices(data.voices ?? [])).catch(() => setVoices([]));
  }, []);
  const loadInputDevices = async () => {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput').map((device) => ({ deviceId: device.deviceId, label: device.label || 'Microphone' }));
    setInputDevices(devices);
  };
  useEffect(() => { void loadInputDevices(); }, []);

  const playAudio = (result: { audio_base64?: string | null; audio_content_type?: string | null }) => {
    if (result.audio_base64) {
      const audio = new Audio(`data:${result.audio_content_type};base64,${result.audio_base64}`);
      void audio.play();
    }
  };

  const requestSetupWelcome = async () => {
    if (!API_URL) {
      setMessages([{ role: 'ai', text: 'Привет! Что хочешь потренировать сегодня — собеседование, путешествие или обычный разговор?', time: currentTime() }]);
      return;
    }
    try {
      const form = new FormData();
      form.append('voice_id', voiceId);
      const response = await fetch(`${API_URL}/api/session/start`, { method: 'POST', body: form });
      if (!response.ok) throw new Error('start failed');
      const result = await response.json();
      setMessages([{ role: 'ai', text: result.reply, time: currentTime() }]);
      playAudio(result);
    } catch {
      setMessages([{ role: 'ai', text: 'Привет! Расскажи, что хочешь потренировать сегодня.', time: currentTime() }]);
    }
  };

  useEffect(() => { void requestSetupWelcome(); }, []);
  useEffect(() => {
    setChats((prev) => prev.map((chat) => chat.id === activeChatId ? { ...chat, messages, language, scenario, phase } : chat));
  }, [messages, language, scenario, phase, activeChatId]);

  const startNewSession = (nextScenario = scenario) => {
    setScenario(nextScenario);
    setMessages([createWelcomeMessage(language)]);
    setPhase('setup');
    setPlaying(false);
    setStatus('Готово к началу');
  };

  const createChat = () => {
    const chat = { id: `chat-${Date.now()}`, title: 'Новый чат', createdAt: Date.now(), messages: [] as Message[], language: 'ru' as Language, scenario: 0, phase: 'setup' as Phase, kind: 'planner' as const, started: false };
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
    setPhase('setup');
    setLanguage('ru');
    setMessages([]);
    setStatus('Готово к началу');
    void requestSetupWelcome();
  };

  const selectChat = (chat: Chat) => {
    setActiveChatId(chat.id);
    setPhase(chat.phase);
    setLanguage(chat.language);
    setScenario(chat.scenario);
    setMessages(chat.messages.length ? chat.messages : chat.kind === 'planner' ? [createWelcomeMessage(chat.language)] : []);
    setStatus('Готово к началу');
  };

  useEffect(() => {
    if (continuous && !recording && phase === 'practice' && chats.find((chat) => chat.id === activeChatId)?.started) void startRecording();
  }, [continuous, phase, activeChatId]);

  const openPracticeRoom = async (chat: Chat) => {
    setPendingRoom(null);
    setActiveChatId(chat.id);
    setPhase('practice');
    setLanguage(chat.language);
    setScenario(chat.scenario);
    setChats((prev) => prev.map((item) => item.id === chat.id ? { ...item, phase: 'practice', started: false } : item));
    setMessages([]);
  };

  const startPracticeRoom = async (chat: Chat) => {
    setChats((prev) => prev.map((item) => item.id === chat.id ? { ...item, started: true } : item));
    if (!API_URL) {
      setMessages([{ role: 'ai', text: 'Отлично, начинаем. Расскажи немного о себе и своём опыте.', time: currentTime() }]);
      return;
    }
    try {
      const form = new FormData();
      form.append('scenario', scenarios[chat.scenario].id);
      form.append('language', chat.language);
      form.append('voice_id', voiceId);
      const response = await fetch(`${API_URL}/api/session/open`, { method: 'POST', body: form });
      if (!response.ok) throw new Error('open failed');
      const result = await response.json();
      setMessages([{ role: 'ai', text: result.reply, time: currentTime() }]);
      playAudio(result);
    } catch {
      setMessages([{ role: 'ai', text: 'Отлично, начинаем. Расскажи немного о себе и своём опыте.', time: currentTime() }]);
    }
  };

  const finishPractice = async () => {
    const room = chats.find((chat) => chat.id === activeChatId);
    if (!room) return;
    setShowFinishDialog(false);
    setEvaluating(true);
    setStatus('Готовлю разбор…');
    if (!API_URL) { setEvaluating(false); return; }
    try {
      const form = new FormData();
      form.append('scenario', scenarios[scenario].id);
      form.append('language', language);
      form.append('voice_id', voiceId);
      form.append('history', JSON.stringify(messages.map((message) => ({ role: message.role, text: message.text }))));
      const response = await fetch(`${API_URL}/api/session/evaluate`, { method: 'POST', body: form });
      if (!response.ok) throw new Error('evaluate failed');
      const result = await response.json();
      const sourceId = room.sourceId || 'chat-1';
      setChats((prev) => prev.map((chat) => chat.id === sourceId ? { ...chat, messages: [...chat.messages, { role: 'ai', text: `Разбор практики «${room.title}»\n\n${result.reply}`, time: currentTime() }] } : chat));
      setActiveChatId(sourceId);
      const source = chats.find((chat) => chat.id === sourceId);
      if (source) { setPhase(source.phase); setLanguage(source.language); setScenario(source.scenario); setMessages([...source.messages, { role: 'ai', text: `Разбор практики «${room.title}»\n\n${result.reply}`, time: currentTime() }]); }
      setStatus('Разбор готов');
      playAudio(result);
    } catch {
      setStatus('Не удалось подготовить разбор');
    } finally {
      setEvaluating(false);
    }
  };

  const startRecording = async () => {
    try {
      // Start speech recognition directly from the pointer event. Chrome may reject
      // recognition if it is started only after the asynchronous mic permission call.
      setClientTranscript(''); clientTranscriptRef.current = ''; setBrowserSpeechAvailable(true);
      const speechApi = (window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
        || (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
      if (speechApi) {
        const recognition = new speechApi();
        recognition.lang = language === 'ru' ? 'ru-RU' : language === 'kk' ? 'kk-KZ' : 'en-US';
        recognition.continuous = true; recognition.interimResults = true;
        recognition.onresult = (event) => {
          let text = '';
          for (let index = 0; index < event.results.length; index += 1) text += `${event.results[index][0].transcript} `;
          clientTranscriptRef.current = text.trim(); setClientTranscript(text.trim());
        };
        recognition.onerror = () => setBrowserSpeechAvailable(false);
        try { recognition.start(); speechRecognition.current = recognition; } catch { setBrowserSpeechAvailable(false); }
      } else setBrowserSpeechAvailable(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      void loadInputDevices();
      const context = new AudioContext(); const source = context.createMediaStreamSource(stream); const processor = context.createScriptProcessor(4096, 1, 1);
      await context.resume();
      audioStream.current = stream; audioContext.current = context; audioSource.current = source; audioProcessor.current = processor; pcmChunks.current = [];
      recordingStartedAt.current = Date.now(); hadVoiceSignal.current = false;
      processor.onaudioprocess = (event) => {
        const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
        const rms = Math.sqrt(chunk.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(chunk.length, 1));
        pcmChunks.current.push(chunk); event.outputBuffer.getChannelData(0).fill(0);
        if (rms >= 0.002) hadVoiceSignal.current = true;
        if (continuous && hadVoiceSignal.current && Date.now() - recordingStartedAt.current > 900 && rms < 0.0015) {
          window.setTimeout(() => { if (recordingRef.current) stopRecording(); }, 1100);
        }
      };
      source.connect(processor); processor.connect(context.destination);
      recordingRef.current = true;
      setRecording(true);
      setStatus(continuous ? 'Слушаю автоматически…' : 'Слушаю…');
    } catch {
      speechRecognition.current?.stop(); speechRecognition.current = null;
      setStatus('Microphone access is needed to practice');
    }
  };

  const submitTurn = async (blob: Blob) => {
    if (!API_URL) {
      window.setTimeout(() => {
        setMessages((prev) => [...prev, { role: 'you', text: 'I would begin by understanding the user needs and then test the first version quickly.', time: currentTime() }]);
        setStatus('Твоя очередь — зажми кнопку');
      }, 700);
      return;
    }
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.wav');
      form.append('scenario', scenarios[scenario].id);
      form.append('language', language);
      form.append('voice_id', voiceId);
      form.append('mode', phase);
      if (clientTranscriptRef.current.trim()) form.append('transcript_override', clientTranscriptRef.current.trim());
      form.append('history', JSON.stringify(messages.map((message) => ({ role: message.role, text: message.text }))));
      const response = await fetch(`${API_URL}/api/session/turn`, { method: 'POST', body: form });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || `Voice service error (${response.status})`);
      }
      const result = await response.json();
      if (phase === 'setup') {
        const nextLanguage = languages.some((item) => item.value === result.language) ? result.language as Language : language;
        const nextScenario = scenarios.findIndex((item) => item.id === result.scenario);
        if (result.ready && result.chat_title && result.chat_title !== 'Новый чат') {
          const room: Chat = { id: `room-${Date.now()}`, title: result.chat_title, createdAt: Date.now(), messages: [], language: nextLanguage, scenario: nextScenario >= 0 ? nextScenario : scenario, phase: 'practice', kind: 'practice', sourceId: activeChatId, started: false };
          setChats((prev) => [...prev, room]);
          setPendingRoom(room);
        }
      }
      setMessages((prev) => [...prev, { role: 'you', text: result.transcript, time: currentTime(), correction: result.correction }, { role: 'ai', text: result.reply, time: currentTime() }]);
      setStatus('Твоя очередь — зажми кнопку');
      playAudio(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not reach the voice service');
    }
  };

  const stopRecording = () => {
    speechRecognition.current?.stop(); speechRecognition.current = null;
    audioProcessor.current?.disconnect(); audioSource.current?.disconnect(); audioStream.current?.getTracks().forEach((track) => track.stop());
    const blob = audioContext.current ? encodeWav(pcmChunks.current, audioContext.current.sampleRate) : null;
    void audioContext.current?.close();
    if (signalLevel(pcmChunks.current) < 0.002) {
      setStatus('Нет сигнала микрофона — проверь устройство и разрешение браузера');
    } else if (blob && blob.size > 44) {
      setStatus('Получаю текст ответа…');
      window.setTimeout(() => {
        if (!clientTranscriptRef.current.trim() && !browserSpeechAvailable) {
          setStatus('Этот браузер не умеет распознавать речь. Открой приложение в Chrome.');
          return;
        }
        if (!clientTranscriptRef.current.trim()) {
          setStatus('Не удалось распознать речь. Говори чуть дольше и проверь разрешение микрофона.');
          return;
        }
        setStatus('Обрабатываю ответ…'); void submitTurn(blob);
      }, 1500);
    }
    recordingRef.current = false;
    setRecording(false);
  };

  const toggleRecording = () => recording ? stopRecording() : startRecording();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◒</span> voxa</div>
        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          <button className="nav-item active"><LayoutGrid size={17} /> Практика</button>
          <button className="nav-item"><BarChart3 size={17} /> Прогресс <span className="nav-badge">4</span></button>
        </nav>
        <div className="chat-list">
          <div className="chat-list-heading"><span>ЧАТЫ</span><button aria-label="Создать чат" onClick={createChat}>＋</button></div>
          {chats.filter((chat) => chat.kind === 'planner').map((chat) => <button className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`} key={chat.id} onClick={() => selectChat(chat)}><span className="chat-dot" />{chat.title}</button>)}
          <div className="chat-list-subheading">КОМНАТЫ ПРАКТИКИ</div>
          {chats.filter((chat) => chat.kind === 'practice').map((chat) => <button className={`chat-item room ${chat.id === activeChatId ? 'active' : ''}`} key={chat.id} onClick={() => selectChat(chat)}><span className="chat-dot" />{chat.title}</button>)}
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item"><CircleHelp size={17} /> Помощь</button>
          <button className="nav-item"><Settings2 size={17} /> Настройки</button>
          <div className="profile"><div className="avatar">AS</div><div><strong>Alex Smith</strong><small>Бесплатный план</small></div><ChevronDown size={15} /></div>
        </div>
      </aside>

      <main className="main-content">
        <header className={`topbar ${activeChat?.kind === 'practice' ? 'practice-mode' : 'planner-mode'}`}><div><div className="mode-label"><span className="mode-dot" />{activeChat?.kind === 'practice' ? 'ТРЕНИРОВОЧНАЯ КОМНАТА' : 'ЧАТ-ПЛАНИРОВЩИК'}</div><h1>{activeChat?.kind === 'practice' ? activeChat.title : 'Говори увереннее.'}</h1><p className="mode-description">{activeChat?.kind === 'practice' ? 'Отвечай спокойно — после завершения разберём каждый ответ.' : 'Расскажи Voxa, какую практику хочешь пройти.'}</p></div><div className="streak"><span>✹</span><div><strong>4 дня подряд</strong><small>Так держать!</small></div></div></header>

        <section className="session-card">
          <div className="session-top">
            <div><span className="eyebrow">ТЕКУЩИЙ СЦЕНАРИЙ</span><button className="scenario-select" onClick={() => setShowScenarioMenu(!showScenarioMenu)}><span className="scenario-icon">{scenarios[scenario].icon}</span><span><strong>{scenarios[scenario].title}</strong><small>{scenarios[scenario].meta}</small></span><ChevronDown size={18} /></button>{showScenarioMenu && <div className="scenario-menu">{scenarios.map((item, index) => <button key={item.title} onClick={() => { startNewSession(index); setShowScenarioMenu(false); }}><span>{item.icon}</span><span><strong>{item.title}</strong><small>{item.meta}</small></span>{index === scenario && <Check size={15} />}</button>)}</div>}</div>
            <label className="voice-select"><span className="eyebrow">МИКРОФОН</span><select value={inputDeviceId} onChange={(event) => setInputDeviceId(event.target.value)}><option value="">Системный по умолчанию</option>{inputDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
            <label className="voice-select"><span className="eyebrow">ЯЗЫК</span><select value={language} onChange={(event) => { const nextLanguage = event.target.value as Language; setLanguage(nextLanguage); setMessages([createWelcomeMessage(nextLanguage)]); setStatus('Готово к началу'); }}>{languages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="voice-select"><span className="eyebrow">ГОЛОС</span><select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}><option value="EXAVITQu4vr4xnSDxMaL">Sarah · warm</option>{voices.map((voice) => <option key={voice.voice_id} value={voice.voice_id}>{voice.name}</option>)}</select></label>
            <div className="session-actions">{phase === 'practice' ? <button className="end-button finish-button" disabled={evaluating} onClick={() => setShowFinishDialog(true)}>{evaluating ? 'Готовлю разбор…' : 'Закончить практику'} <X size={15} /></button> : <button className="icon-button" aria-label="Начать новый чат" onClick={createChat}><RotateCcw size={17} /></button>}</div>
          </div>
          <div className="divider" />
          <div className="conversation">
            {messages.map((message, index) => <div className={`message-row ${message.role}`} key={`${message.time}-${index}`}><div className="message-avatar">{message.role === 'ai' ? <Sparkles size={15} /> : 'AS'}</div><div className="message-body"><div className="message-meta"><strong>{message.role === 'ai' ? 'Voxa' : 'Ты'}</strong><span>{message.time}</span>{message.role === 'ai' && <span className="ai-pill">AI</span>}</div><div className="bubble">{message.text}{message.correction && <span className="error-dot" />}</div>{message.correction && <button className="feedback"><span>Грамматика</span> “{message.correction.original}” → “{message.correction.suggestion}” <ArrowUpRight size={13} /></button>}{message.role === 'ai' && index === messages.length - 1 && <button className="listen" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Пауза' : 'Слушать ответ'} <span>0:08</span></button>}</div></div>)}
          </div>
          <div className="divider" />
            {pendingRoom && pendingRoom.sourceId === activeChatId && <div className="room-invite"><div><strong>Комната готова: {pendingRoom.title}</strong><small>Я собрала настройки. Перенесёмся туда и начнём отдельную практику?</small></div><button onClick={() => void openPracticeRoom(pendingRoom)}>Перейти в комнату</button></div>}
            {phase === 'practice' && !chats.find((chat) => chat.id === activeChatId)?.started && <div className="start-room"><p>Комната настроена. Когда будешь готов, нажми кнопку ниже.</p><button onClick={() => { const room = chats.find((chat) => chat.id === activeChatId); if (room) void startPracticeRoom(room); }}>Начать практику</button></div>}
            {evaluating && <div className="analysis-banner"><span className="analysis-spinner" /><div><strong>Анализирую твою практику</strong><small>Собираю сильные стороны, ошибки и более удачные формулировки…</small></div></div>}
            <div className="practice-footer">
            <div className="voice-status"><div className={`pulse ${recording ? 'live' : ''}`}><span>{recording ? '•••' : '✦'}</span></div><div><strong>{status}</strong><small>{recording ? 'Отпусти, чтобы отправить' : 'Зажми кнопку, чтобы говорить'}</small></div></div>
            <div className="waveform">{Array.from({ length: 34 }).map((_, i) => <i key={i} style={{ height: `${12 + ((i * 19) % 32)}px` }} className={recording ? 'wave-live' : ''} />)}</div>
            <div className="controls"><button aria-label="Зажми, чтобы говорить" className={`mic-button ${recording ? 'recording' : ''}`} onPointerDown={startRecording} onPointerUp={stopRecording} onPointerCancel={stopRecording} onPointerLeave={recording ? stopRecording : undefined}><Mic size={23} /></button><button className={`continuous ${continuous ? 'on' : ''}`} onClick={() => setContinuous(!continuous)}><span className="switch" /> Непрерывное слушание</button></div>
          </div>
        </section>
        <div className="tip"><Headphones size={16} /><span><strong>Совет:</strong> Отвечай 2–3 предложениями. Не бойся ошибок — для этого и нужна практика.</span><button>Скрыть</button></div>
      </main>
      {showFinishDialog && <div className="modal-backdrop" role="presentation" onClick={() => setShowFinishDialog(false)}><div className="finish-modal" role="dialog" aria-modal="true" aria-labelledby="finish-title" onClick={(event) => event.stopPropagation()}><div className="modal-icon"><Check size={20} /></div><h2 id="finish-title">Закончить практику?</h2><p>Voxa сохранит твои ответы и подготовит персональный разбор. После этого ты вернёшься в чат, где создавал эту комнату.</p><div className="modal-actions"><button className="modal-cancel" onClick={() => setShowFinishDialog(false)}>Продолжить</button><button className="modal-confirm" onClick={() => void finishPractice()}>Да, завершить</button></div></div></div>}
    </div>
  );
}

export default App;

createRoot(document.getElementById('root')!).render(<App />);
