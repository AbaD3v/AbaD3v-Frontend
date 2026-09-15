import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Check, ChevronDown, CircleHelp, Headphones, MessageCircle, Mic, Pause, Play, RotateCcw, Settings2, Sparkles, Trash2, Users, Volume2, X } from 'lucide-react';
import './styles.css';

type Correction = { original: string; suggestion: string; explanation: string };
type Message = { role: 'ai' | 'you'; text: string; time: string; correction?: Correction | null };
type Voice = { voice_id: string; name: string; category?: string };
type InputDevice = { deviceId: string; label: string };
type Chat = { id: string; title: string; createdAt: number; messages: Message[]; language: Language; scenario: number; phase: Phase; kind: 'planner' | 'practice'; sourceId?: string; started: boolean };
type Phase = 'setup' | 'practice';
type Language = 'en' | 'ru' | 'kk';
type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
type Page = 'practice' | 'team';
type SettingOption = { value: string; label: string };

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
const presets: Array<{ name: string; description: string; scenario: number; language: Language; continuous: boolean }> = [];

const team = [
  { name: 'Abzal M', role: 'Основатель · Lead developer', initials: 'AM', github: 'https://github.com/AbaD3v', avatar: 'https://github.com/AbaD3v.png?size=160', lead: true },
  { name: 'Ersultan K', role: 'Участник команды', initials: 'EK', github: 'https://github.com/ersultankargul07-alt', avatar: 'https://github.com/ersultankargul07-alt.png?size=160', lead: false },
  { name: 'Ayadil M', role: 'Участник команды', initials: 'AM', github: 'https://github.com/mukasevaadil2-cmd', avatar: 'https://github.com/mukasevaadil2-cmd.png?size=160', lead: false },
  { name: 'Rasul K', role: 'Участник команды', initials: 'RK', github: 'https://github.com/vancitygarfield', avatar: 'https://github.com/vancitygarfield.png?size=160', lead: false },
  { name: 'Beibarys M', role: 'Участник команды', initials: 'BM', github: 'https://github.com/Terbarys', avatar: 'https://github.com/Terbarys.png?size=160', lead: false },
];
const teamStats = [
  { value: '05', label: 'участников' },
  { value: '03', label: 'языка' },
  { value: '∞', label: 'идей впереди' },
];

const welcomeTexts: Record<Language, string> = {
  en: "Hi Alex, welcome. Let's start with a classic one: could you tell me about a project you're particularly proud of?",
  ru: 'Привет, Алекс! Начнём с классического вопроса: расскажи о проекте, которым ты особенно гордишься.',
  kk: 'Сәлем, Алекс! Классикалық сұрақтан бастайық: өзің ерекше мақтан тұтатын жоба туралы айтып бере аласың ба?',
};
const currentTime = () => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date());
const createWelcomeMessage = (language: Language): Message => ({ role: 'ai', text: welcomeTexts[language], time: currentTime() });
const API_URL = import.meta.env.VITE_API_URL;

function SettingSelect({ id, label, value, options, onChange, openId, setOpenId }: { id: string; label: string; value: string; options: SettingOption[]; onChange: (value: string) => void; openId: string | null; setOpenId: (id: string | null) => void }) {
  const open = openId === id;
  const selected = options.find((option) => option.value === value) ?? options[0];
  return <div className="settings-field custom-field"><span>{label}</span><div className="setting-select"><button type="button" className={`setting-select-trigger ${open ? 'open' : ''}`} onClick={() => setOpenId(open ? null : id)}><span>{selected?.label}</span><ChevronDown size={14} /></button>{open && <div className="setting-select-menu">{options.map((option) => <button type="button" key={option.value} className={option.value === value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpenId(null); }}>{option.label}{option.value === value && <Check size={14} />}</button>)}</div>}</div></div>;
}

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
  const [page, setPage] = useState<Page>('practice');
  const [selectedMember, setSelectedMember] = useState(team[0]);
  const [scenario, setScenario] = useState(0);
  const [language, setLanguage] = useState<Language>('ru');
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>('setup');
  const [chats, setChats] = useState<Chat[]>([{ id: 'chat-1', title: 'Новый чат', createdAt: Date.now(), messages: [], language: 'ru', scenario: 0, phase: 'setup', kind: 'planner', started: false }]);
  const [activeChatId, setActiveChatId] = useState('chat-1');
  const [pendingRoom, setPendingRoom] = useState<Chat | null>(null);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openSettingSelect, setOpenSettingSelect] = useState<string | null>(null);
  const [chatToDelete, setChatToDelete] = useState<Chat | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showScenarioMenu, setShowScenarioMenu] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('');
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

  const togglePlayback = (text: string) => {
    if (!('speechSynthesis' in window)) {
      setStatus('Озвучивание недоступно в этом браузере');
      return;
    }
    if (playing) {
      window.speechSynthesis.cancel();
      setPlaying(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === 'ru' ? 'ru-RU' : language === 'kk' ? 'kk-KZ' : 'en-US';
    utterance.rate = 0.95;
    utterance.onend = () => setPlaying(false);
    utterance.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(utterance);
    setPlaying(true);
  };

  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  useEffect(() => () => { audioProcessor.current?.disconnect(); audioSource.current?.disconnect(); audioStream.current?.getTracks().forEach((track) => track.stop()); void audioContext.current?.close(); }, []);
  useEffect(() => {
    if (!API_URL) return;
    fetch(`${API_URL}/api/voices`).then((response) => response.json()).then((data) => {
      const availableVoices = data.voices ?? [];
      setVoices(availableVoices);
      setVoiceId((current) => availableVoices.some((voice: Voice) => voice.voice_id === current) ? current : (availableVoices[0]?.voice_id ?? ''));
    }).catch(() => setVoices([]));
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
    setPage('practice');
    const chat = { id: `chat-${Date.now()}`, title: 'Новый чат', createdAt: Date.now(), messages: [] as Message[], language: 'ru' as Language, scenario: 0, phase: 'setup' as Phase, kind: 'planner' as const, started: false };
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
    setPhase('setup');
    setLanguage('ru');
    setMessages([]);
    setStatus('Готово к началу');
    void requestSetupWelcome();
  };

  const deleteChat = (chatId: string) => {
    const remaining = chats.filter((chat) => chat.id !== chatId);
    if (!remaining.length) {
      const freshChat: Chat = { id: `chat-${Date.now()}`, title: 'Новый чат', createdAt: Date.now(), messages: [], language: 'ru', scenario: 0, phase: 'setup', kind: 'planner', started: false };
      setChats([freshChat]); setActiveChatId(freshChat.id); setMessages([]); setPage('practice');
    } else if (chatId === activeChatId) {
      selectChat(remaining[0]);
      setChats(remaining);
    } else setChats(remaining);
    setChatToDelete(null);
  };

  const selectChat = (chat: Chat) => {
    setPage('practice');
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
        if (!clientTranscriptRef.current.trim() && !API_URL) {
          setStatus('Не удалось распознать речь: запусти backend или открой приложение в Chrome.');
          return;
        }
        setStatus(clientTranscriptRef.current.trim() ? 'Обрабатываю ответ…' : 'Распознаю запись на backend…');
        void submitTurn(blob);
      }, 1500);
    }
    recordingRef.current = false;
    setRecording(false);
  };

  const toggleRecording = () => recording ? stopRecording() : startRecording();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◒</span><span>voxa</span><small>voice practice studio</small></div>
        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          <button className={`nav-item ${page === 'practice' ? 'active' : ''}`} onClick={() => setPage('practice')}><MessageCircle size={17} /> Чаты <span className="nav-badge">{chats.length}</span></button>
          <button className={`nav-item ${page === 'team' ? 'active' : ''}`} onClick={() => setPage('team')}><Users size={17} /> Команда</button>
        </nav>
        <div className="chat-list">
          <div className="chat-list-heading"><span>ЧАТЫ</span><button aria-label="Создать чат" onClick={createChat}>＋</button></div>
          {chats.filter((chat) => chat.kind === 'planner').map((chat) => <div className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`} key={chat.id}><button className="chat-select" onClick={() => selectChat(chat)}><span className="chat-dot" /><span className="chat-title">{chat.title}</span></button><button className="chat-delete" aria-label={`Удалить чат ${chat.title}`} onClick={() => setChatToDelete(chat)}><Trash2 size={13} /></button></div>)}
          <div className="chat-list-subheading">КОМНАТЫ ПРАКТИКИ</div>
          {chats.filter((chat) => chat.kind === 'practice').map((chat) => <div className={`chat-item room ${chat.id === activeChatId ? 'active' : ''}`} key={chat.id}><button className="chat-select" onClick={() => selectChat(chat)}><span className="chat-dot" /><span className="chat-title">{chat.title}</span></button><button className="chat-delete" aria-label={`Удалить чат ${chat.title}`} onClick={() => setChatToDelete(chat)}><Trash2 size={13} /></button></div>)}
        </div>
        <div className="sidebar-note"><span className="sidebar-note-mark">✦</span><div><strong>Говори смелее</strong><small>Каждый ответ — шаг вперёд</small></div></div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setShowHelp(true)}><CircleHelp size={17} /> Помощь</button>
          <button className="nav-item" onClick={() => setShowSettings(true)}><Settings2 size={17} /> Настройки</button>
          <div className="profile"><div className="avatar">AS</div><div><strong>Alex Smith</strong><small>Бесплатный план</small></div><ChevronDown size={15} /></div>
        </div>
      </aside>

      <main className={`main-content ${page === 'team' ? 'team-page' : ''}`}>
        {page === 'team' && <>
          <div className="team-side-note team-side-left"><span>01</span><strong>ВМЕСТЕ</strong><small>говорим громче</small></div><div className="team-side-note team-side-right"><span>VOXA / 26</span><strong>СОЗДАЁМ</strong><small>пространство для голоса</small></div>
          <header className="team-hero">
            <div className="team-hero-copy"><div className="mode-label"><span className="mode-dot team-dot" /> О ПРОЕКТЕ</div><h1>Говорим.<br /><em>Создаём.</em><br />Растём.</h1><p>Команда, которая превращает страх говорить на другом языке в привычку расти вместе.</p><div className="team-stats">{teamStats.map((stat) => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}</div></div>
            <div className="team-orbit" aria-label="Созвездие команды"><div className="orbit-ring orbit-ring-one" /><div className="orbit-ring orbit-ring-two" /><div className="orbit-core"><span>◒</span><small>VOXA</small></div>{team.map((member, index) => <button type="button" key={member.github} className={`orbit-node orbit-node-${index + 1} ${selectedMember.github === member.github ? 'selected' : ''} ${member.lead ? 'orbit-lead' : ''}`} onClick={() => setSelectedMember(member)} aria-label={`Открыть информацию о ${member.name}`}><span>{member.initials}</span><img src={member.avatar} alt={`Аватар ${member.name}`} onError={(event) => { event.currentTarget.style.display = 'none'; }} /></button>)}<div className="orbit-spark spark-one">✦</div><div className="orbit-spark spark-two">·</div><div className="orbit-profile-panel" key={selectedMember.github}><div className="panel-avatar"><span>{selectedMember.initials}</span><img src={selectedMember.avatar} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} /></div><div className="panel-copy"><small>В КОМАНДЕ VOXA</small><strong>{selectedMember.name}</strong><span>{selectedMember.role}</span><a href={selectedMember.github} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={12} /></a></div></div></div>
          </header>
          <section className="team-intro"><div className="team-intro-mark">“</div><div><span className="eyebrow">НАШ МАНИФЕСТ</span><h2>Ошибаться — тоже часть процесса.</h2><p>Voxa помогает тренировать разговорную речь через живые сценарии, голосовые ответы и понятную обратную связь.</p></div><span className="intro-arrow">↗</span></section>
          <div className="team-ribbon" aria-label="Имена команды"><div className="team-ribbon-track"><span>ABZAL</span><i>✦</i><span>ERSULTAN</span><i>✦</i><span>AYADIL</span><i>✦</i><span>RASUL</span><i>✦</i><span>BEIBARYS</span><i>✦</i><span>ABZAL</span><i>✦</i><span>ERSULTAN</span><i>✦</i><span>AYADIL</span><i>✦</i><span>RASUL</span><i>✦</i><span>BEIBARYS</span><i>✦</i></div></div>
          <div className="team-heading"><div><span className="eyebrow">НАША КОМАНДА</span><h2>Люди, которые делают Voxa</h2></div><span className="team-count">{team.length} участников</span></div>
          <section className="team-grid">{team.map((member, index) => <article className={`team-card ${member.lead ? 'team-card-lead' : ''}`} key={member.github}><span className="member-index">0{index + 1}</span><div className="member-top"><div className="member-avatar"><span>{member.initials}</span><img src={member.avatar} alt={`Аватар ${member.name}`} onError={(event) => { event.currentTarget.style.display = 'none'; }} /></div>{member.lead && <span className="lead-badge">LEAD</span>}<a className="github-link" href={member.github} target="_blank" rel="noreferrer" aria-label={`GitHub ${member.name}`}>GH</a></div><h3>{member.name}</h3><p>{member.role}</p><a className="member-profile" href={member.github} target="_blank" rel="noreferrer">Открыть профиль <ArrowUpRight size={13} /></a></article>)}</section>
        </>}
        <header className={`topbar ${activeChat?.kind === 'practice' ? 'practice-mode' : 'planner-mode'}`}><div><div className="mode-label"><span className="mode-dot" />{activeChat?.kind === 'practice' ? 'ТРЕНИРОВОЧНАЯ КОМНАТА' : 'ЧАТ-ПЛАНИРОВЩИК'}</div><h1>{activeChat?.kind === 'practice' ? activeChat.title : 'Говори увереннее.'}</h1><p className="mode-description">{activeChat?.kind === 'practice' ? 'Отвечай спокойно — после завершения разберём каждый ответ.' : 'Расскажи Voxa, какую практику хочешь пройти.'}</p></div><div className="streak"><span>✹</span><div><strong>4 дня подряд</strong><small>Так держать!</small></div></div></header>

        <section className="session-card">
          <div className="session-top">
            <div><span className="eyebrow">ТЕКУЩИЙ СЦЕНАРИЙ</span>{activeChat?.kind === 'planner' ? <div className="scenario-progress"><span className="scenario-icon progress-icon">…</span><span><strong>В процессе</strong><small>Тема формируется в чате</small></span><MessageCircle size={16} /></div> : <><button className="scenario-select" onClick={() => setShowScenarioMenu(!showScenarioMenu)}><span className="scenario-icon">{scenarios[scenario].icon}</span><span><strong>{scenarios[scenario].title}</strong><small>{scenarios[scenario].meta}</small></span><ChevronDown size={18} /></button>{showScenarioMenu && <div className="scenario-menu">{scenarios.map((item, index) => <button key={item.title} onClick={() => { startNewSession(index); setShowScenarioMenu(false); }}><span>{item.icon}</span><span><strong>{item.title}</strong><small>{item.meta}</small></span>{index === scenario && <Check size={15} />}</button>)}</div>}</>}</div>
            <button className="session-preferences" onClick={() => setShowSettings(true)}><span className="preferences-icon"><Settings2 size={15} /></span><span><strong>Настройки сессии</strong><small>{languages.find((item) => item.value === language)?.label} · {voiceId === 'EXAVITQu4vr4xnSDxMaL' ? 'Sarah · warm' : 'Голос Voxa'}</small></span><ArrowUpRight size={14} /></button>
            <div className="session-actions">{phase === 'practice' ? <button className="end-button finish-button" disabled={evaluating} onClick={() => setShowFinishDialog(true)}>{evaluating ? 'Готовлю разбор…' : 'Закончить практику'} <X size={15} /></button> : <button className="icon-button" aria-label="Начать новый чат" onClick={createChat}><RotateCcw size={17} /></button>}</div>
          </div>
          <div className="divider" />
          <div className="conversation">
            {messages.map((message, index) => <div className={`message-row ${message.role}`} key={`${message.time}-${index}`}><div className="message-avatar">{message.role === 'ai' ? <Sparkles size={15} /> : 'AS'}</div><div className="message-body"><div className="message-meta"><strong>{message.role === 'ai' ? 'Voxa' : 'Ты'}</strong><span>{message.time}</span>{message.role === 'ai' && <span className="ai-pill">AI</span>}</div><div className="bubble">{message.text}{message.correction && <span className="error-dot" />}</div>{message.correction && <button className="feedback"><span>Грамматика</span> “{message.correction.original}” → “{message.correction.suggestion}” <ArrowUpRight size={13} /></button>}{message.role === 'ai' && index === messages.length - 1 && <button className="listen" onClick={() => togglePlayback(message.text)}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Остановить' : 'Слушать ответ'} <span>{playing ? '•••' : '0:08'}</span></button>}</div></div>)}
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
      {chatToDelete && <div className="modal-backdrop" role="presentation" onClick={() => setChatToDelete(null)}><div className="finish-modal delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={(event) => event.stopPropagation()}><div className="modal-icon delete-icon"><Trash2 size={19} /></div><h2 id="delete-title">Удалить чат?</h2><p>Чат «{chatToDelete.title}» и его история будут удалены из этого пространства. Это действие нельзя отменить.</p><div className="modal-actions"><button className="modal-cancel" onClick={() => setChatToDelete(null)}>Оставить</button><button className="modal-confirm delete-confirm" onClick={() => deleteChat(chatToDelete.id)}>Удалить чат</button></div></div></div>}
      {showHelp && <div className="modal-backdrop" role="presentation" onClick={() => setShowHelp(false)}><div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}><div className="help-header"><div className="modal-icon"><CircleHelp size={20} /></div><button className="help-close" aria-label="Закрыть помощь" onClick={() => setShowHelp(false)}><X size={17} /></button><span className="eyebrow">VOXA CARE</span><h2 id="help-title">Чем помочь?</h2><p>Короткие подсказки, чтобы практика шла без лишних пауз.</p></div><div className="help-grid"><article><div className="help-card-icon"><Mic size={16} /></div><div><strong>Не слышит микрофон</strong><p>Проверь разрешение браузера и выбери устройство в поле «Микрофон».</p></div></article><article><div className="help-card-icon"><Headphones size={16} /></div><div><strong>Как начать практику</strong><p>Создай чат, выбери сценарий и зажми оранжевую кнопку, пока говоришь.</p></div></article><article><div className="help-card-icon"><MessageCircle size={16} /></div><div><strong>Нужен другой язык</strong><p>Русский, English и Қазақша можно переключить перед началом ответа.</p></div></article><article><div className="help-card-icon"><Sparkles size={16} /></div><div><strong>Разбор после ответа</strong><p>Заверши комнату — Voxa покажет сильные стороны и полезные исправления.</p></div></article></div><div className="help-footer"><span>Совет</span><strong>Отвечай 2–3 предложениями — этого достаточно для хорошего старта.</strong></div></div></div>}
      {showSettings && <div className="modal-backdrop" role="presentation" onClick={() => setShowSettings(false)}><div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}><div className="settings-header"><div><span className="eyebrow">WORKSPACE SETTINGS</span><h2 id="settings-title">Настройки Voxa</h2><p>Подстрой пространство под свой темп и голос.</p></div><button className="help-close" aria-label="Закрыть настройки" onClick={() => setShowSettings(false)}><X size={17} /></button></div><div className="settings-section scenario-settings"><div className="settings-section-title"><span className="settings-section-icon">✦</span><div><strong>Тема практики</strong><small>Выбери сценарий для нового разговора</small></div></div><div className="scenario-settings-grid">{scenarios.map((item, index) => <button type="button" className={index === scenario ? 'selected' : ''} key={item.id} onClick={() => { setScenario(index); setShowScenarioMenu(false); }}><span className="scenario-settings-icon">{item.icon}</span><span><strong>{item.title}</strong><small>{item.meta}</small></span>{index === scenario && <Check size={14} />}</button>)}</div><div className="preset-label">БЫСТРЫЕ ПРЕСЕТЫ</div><div className="preset-row">{presets.map((preset) => <button type="button" key={preset.name} onClick={() => { setScenario(preset.scenario); setLanguage(preset.language); setContinuous(preset.continuous); setMessages([createWelcomeMessage(preset.language)]); }}><strong>{preset.name}</strong><small>{preset.description}</small><ArrowUpRight size={12} /></button>)}</div></div><div className="settings-section"><div className="settings-section-title"><span className="settings-section-icon"><Sparkles size={15} /></span><div><strong>Практика</strong><small>Как Voxa будет с тобой работать</small></div></div><SettingSelect id="language" label="Язык интерфейса и ответов" value={language} options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }, { value: 'kk', label: 'Қазақша' }]} onChange={(value) => { const nextLanguage = value as Language; setLanguage(nextLanguage); setMessages([createWelcomeMessage(nextLanguage)]); }} openId={openSettingSelect} setOpenId={setOpenSettingSelect} /><button className={`settings-toggle ${continuous ? 'on' : ''}`} onClick={() => setContinuous(!continuous)}><span><strong>Непрерывное слушание</strong><small>Voxa сама начнёт слушать после ответа</small></span><span className="switch" /></button></div><div className="settings-section"><div className="settings-section-title"><span className="settings-section-icon"><Mic size={15} /></span><div><strong>Аудио</strong><small>Микрофон и голос ассистента</small></div></div><SettingSelect id="microphone" label="Микрофон" value={inputDeviceId} options={[{ value: '', label: 'Системный по умолчанию' }, ...inputDevices.map((device) => ({ value: device.deviceId, label: device.label }))]} onChange={setInputDeviceId} openId={openSettingSelect} setOpenId={setOpenSettingSelect} /><SettingSelect id="voice" label="Голос Voxa" value={voiceId} options={[{ value: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah · warm' }, ...voices.map((voice) => ({ value: voice.voice_id, label: voice.name }))]} onChange={setVoiceId} openId={openSettingSelect} setOpenId={setOpenSettingSelect} /></div><div className="settings-footer"><span><span className="settings-status-dot" />Изменения применяются сразу</span><button className="settings-done" onClick={() => setShowSettings(false)}><Check size={14} /> Готово</button></div></div></div>}
    </div>
  );
}

export default App;

createRoot(document.getElementById('root')!).render(<App />);
