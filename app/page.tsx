"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Side = "left" | "right";
type Tab = "translate" | "chats" | "meetings" | "settings";

type Language = {
  label: string;
  locale: string;
  flag: string;
};

type Exchange = {
  id: string;
  at: string;
  speaker: Side;
  from: string;
  to: string;
  source: string;
  translated: string;
};

type SavedSession = {
  id: string;
  name: string;
  createdAt: string;
  exchanges: Exchange[];
};

type SavedMeeting = {
  id: string;
  name: string;
  createdAt: string;
  durationSec: number;
  exchanges: Exchange[];
};

const LANGUAGES: Language[] = [
  { label: "English (United States)", locale: "en-US", flag: "🇺🇸" },
  { label: "English (United Kingdom)", locale: "en-GB", flag: "🇬🇧" },
  { label: "Spanish (Mexico)", locale: "es-MX", flag: "🇲🇽" },
  { label: "Spanish (Spain)", locale: "es-ES", flag: "🇪🇸" },
  { label: "French (France)", locale: "fr-FR", flag: "🇫🇷" },
  { label: "French (Canada)", locale: "fr-CA", flag: "🇨🇦" },
  { label: "German", locale: "de-DE", flag: "🇩🇪" },
  { label: "Italian", locale: "it-IT", flag: "🇮🇹" },
  { label: "Portuguese (Brazil)", locale: "pt-BR", flag: "🇧🇷" },
  { label: "Portuguese (Portugal)", locale: "pt-PT", flag: "🇵🇹" },
  { label: "Dutch", locale: "nl-NL", flag: "🇳🇱" },
  { label: "Swedish", locale: "sv-SE", flag: "🇸🇪" },
  { label: "Norwegian", locale: "no-NO", flag: "🇳🇴" },
  { label: "Danish", locale: "da-DK", flag: "🇩🇰" },
  { label: "Finnish", locale: "fi-FI", flag: "🇫🇮" },
  { label: "Polish", locale: "pl-PL", flag: "🇵🇱" },
  { label: "Czech", locale: "cs-CZ", flag: "🇨🇿" },
  { label: "Slovak", locale: "sk-SK", flag: "🇸🇰" },
  { label: "Hungarian", locale: "hu-HU", flag: "🇭🇺" },
  { label: "Romanian", locale: "ro-RO", flag: "🇷🇴" },
  { label: "Greek", locale: "el-GR", flag: "🇬🇷" },
  { label: "Turkish", locale: "tr-TR", flag: "🇹🇷" },
  { label: "Russian", locale: "ru-RU", flag: "🇷🇺" },
  { label: "Ukrainian", locale: "uk-UA", flag: "🇺🇦" },
  { label: "Arabic (Saudi Arabia)", locale: "ar-SA", flag: "🇸🇦" },
  { label: "Hebrew", locale: "he-IL", flag: "🇮🇱" },
  { label: "Persian", locale: "fa-IR", flag: "🇮🇷" },
  { label: "Hindi", locale: "hi-IN", flag: "🇮🇳" },
  { label: "Bengali", locale: "bn-BD", flag: "🇧🇩" },
  { label: "Urdu", locale: "ur-PK", flag: "🇵🇰" },
  { label: "Tamil", locale: "ta-IN", flag: "🇮🇳" },
  { label: "Telugu", locale: "te-IN", flag: "🇮🇳" },
  { label: "Thai", locale: "th-TH", flag: "🇹🇭" },
  { label: "Vietnamese", locale: "vi-VN", flag: "🇻🇳" },
  { label: "Indonesian", locale: "id-ID", flag: "🇮🇩" },
  { label: "Malay", locale: "ms-MY", flag: "🇲🇾" },
  { label: "Filipino", locale: "fil-PH", flag: "🇵🇭" },
  { label: "Chinese (Simplified)", locale: "zh-CN", flag: "🇨🇳" },
  { label: "Chinese (Traditional)", locale: "zh-TW", flag: "🇹🇼" },
  { label: "Japanese", locale: "ja-JP", flag: "🇯🇵" },
  { label: "Korean", locale: "ko-KR", flag: "🇰🇷" },
  { label: "Khmer", locale: "km-KH", flag: "🇰🇭" },
  { label: "Lao", locale: "lo-LA", flag: "🇱🇦" },
  { label: "Burmese", locale: "my-MM", flag: "🇲🇲" },
  { label: "Swahili", locale: "sw-KE", flag: "🇰🇪" },
  { label: "Afrikaans", locale: "af-ZA", flag: "🇿🇦" },
  { label: "Zulu", locale: "zu-ZA", flag: "🇿🇦" },
  { label: "Somali", locale: "so-SO", flag: "🇸🇴" },
  { label: "Amharic", locale: "am-ET", flag: "🇪🇹" },
  { label: "Haitian Creole", locale: "ht-HT", flag: "🇭🇹" }
];

const STORAGE = {
  chats: "lingoswap.savedChats.v1",
  meetings: "lingoswap.savedMeetings.v1",
  settings: "lingoswap.settings.v1"
};

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function id() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(16).slice(2);
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function transcript(exchanges: Exchange[]) {
  return exchanges
    .map(function (item) {
      const side = item.speaker === "left" ? "Speaker A" : "Speaker B";
      return "[" + item.at + "] " + side + " (" + item.from + " → " + item.to + ")\n" + item.source + "\n→ " + item.translated;
    })
    .join("\n\n");
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("translate");
  const [leftLocale, setLeftLocale] = useState("en-US");
  const [rightLocale, setRightLocale] = useState("es-MX");
  const [leftText, setLeftText] = useState("");
  const [rightText, setRightText] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [savedChats, setSavedChats] = useState<SavedSession[]>([]);
  const [savedMeetings, setSavedMeetings] = useState<SavedMeeting[]>([]);
  const [activeSide, setActiveSide] = useState<Side | null>(null);
  const [busySide, setBusySide] = useState<Side | null>(null);
  const [status, setStatus] = useState("Ready");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [autoHandoff, setAutoHandoff] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [earcons, setEarcons] = useState(false);
  const [logTranscript, setLogTranscript] = useState(true);
  const [meetingStartedAt, setMeetingStartedAt] = useState<number | null>(null);
  const [meetingEntries, setMeetingEntries] = useState<Exchange[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [search, setSearch] = useState("");

  const recognitionRef = useRef<any>(null);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechBufferRef = useRef("");
  const hydratedRef = useRef(false);
  const startListeningRef = useRef<(side: Side) => void>(function () {});

  const leftLanguage = useMemo(
    function () { return LANGUAGES.find(function (language) { return language.locale === leftLocale; }) || LANGUAGES[0]; },
    [leftLocale]
  );
  const rightLanguage = useMemo(
    function () { return LANGUAGES.find(function (language) { return language.locale === rightLocale; }) || LANGUAGES[2]; },
    [rightLocale]
  );

  useEffect(function () {
    try {
      const chats = localStorage.getItem(STORAGE.chats);
      const meetings = localStorage.getItem(STORAGE.meetings);
      const settings = localStorage.getItem(STORAGE.settings);
      if (chats) setSavedChats(JSON.parse(chats));
      if (meetings) setSavedMeetings(JSON.parse(meetings));
      if (settings) {
        const value = JSON.parse(settings);
        if (value.theme === "light" || value.theme === "dark") setTheme(value.theme);
        if (typeof value.autoHandoff === "boolean") setAutoHandoff(value.autoHandoff);
        if (typeof value.haptics === "boolean") setHaptics(value.haptics);
        if (typeof value.earcons === "boolean") setEarcons(value.earcons);
        if (typeof value.logTranscript === "boolean") setLogTranscript(value.logTranscript);
      }
    } catch {
      setStatus("Local history could not be loaded.");
    }
    hydratedRef.current = true;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(function () {
        // PWA shell still works as a normal web app if registration is unavailable.
      });
    }
  }, []);

  useEffect(function () {
    document.documentElement.dataset.theme = theme;
    if (!hydratedRef.current) return;
    localStorage.setItem(
      STORAGE.settings,
      JSON.stringify({ theme, autoHandoff, haptics, earcons, logTranscript })
    );
  }, [theme, autoHandoff, haptics, earcons, logTranscript]);

  useEffect(function () {
    if (!hydratedRef.current) return;
    localStorage.setItem(STORAGE.chats, JSON.stringify(savedChats));
  }, [savedChats]);

  useEffect(function () {
    if (!hydratedRef.current) return;
    localStorage.setItem(STORAGE.meetings, JSON.stringify(savedMeetings));
  }, [savedMeetings]);

  useEffect(function () {
    if (!meetingStartedAt) {
      setElapsed(0);
      return;
    }
    const timer = window.setInterval(function () {
      setElapsed(Math.floor((Date.now() - meetingStartedAt) / 1000));
    }, 1000);
    return function () { window.clearInterval(timer); };
  }, [meetingStartedAt]);

  const vibrate = useCallback(function (pattern: number | number[]) {
    if (haptics && "vibrate" in navigator) navigator.vibrate(pattern);
  }, [haptics]);

  const tone = useCallback(function () {
    if (!earcons) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 700;
      gain.gain.value = 0.03;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.08);
    } catch {
      // Earcons are optional.
    }
  }, [earcons]);

  const speak = useCallback(function (
    text: string,
    locale: string,
    onDone?: () => void
  ) {
    if (!("speechSynthesis" in window)) {
      setStatus("Translation complete. Speech playback is not supported in this browser.");
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    utterance.rate = 0.98;
    utterance.onend = function () { onDone?.(); };
    utterance.onerror = function () {
      setStatus("Translation complete, but speech playback failed.");
      onDone?.();
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  const translateText = useCallback(async function (speaker: Side, raw: string) {
    const text = raw.trim();
    if (!text || busySide) return;

    const from = speaker === "left" ? leftLanguage : rightLanguage;
    const to = speaker === "left" ? rightLanguage : leftLanguage;
    setBusySide(speaker);
    setStatus("Translating…");

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: from.locale, target: to.locale })
      });
      const data = await response.json();
      if (!response.ok || typeof data.translatedText !== "string") {
        throw new Error(data.error || "Translation failed.");
      }

      const translatedText = data.translatedText.trim();
      if (speaker === "left") setRightText(translatedText);
      else setLeftText(translatedText);

      const exchange: Exchange = {
        id: id(),
        at: nowLabel(),
        speaker,
        from: from.label,
        to: to.label,
        source: text,
        translated: translatedText
      };

      if (logTranscript) setHistory(function (items) { return items.concat(exchange); });
      if (meetingStartedAt) setMeetingEntries(function (items) { return items.concat(exchange); });

      setStatus("Translation complete");
      vibrate(35);
      speak(translatedText, to.locale, function () {
        if (autoHandoff) {
          const nextSide: Side = speaker === "left" ? "right" : "left";
          setStatus("Handing off to " + (nextSide === "left" ? "Speaker A" : "Speaker B") + "…");
          window.setTimeout(function () { startListeningRef.current(nextSide); }, 350);
        }
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Translation failed.");
      vibrate([60, 60, 60]);
    } finally {
      setBusySide(null);
    }
  }, [
    autoHandoff,
    busySide,
    leftLanguage,
    logTranscript,
    meetingStartedAt,
    rightLanguage,
    speak,
    vibrate
  ]);

  const stopListening = useCallback(function () {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    silenceRef.current = null;
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
    setActiveSide(null);
    setStatus("Ready");
    tone();
  }, [tone]);

  const startListening = useCallback(function (side: Side) {
    if (busySide) return;
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setStatus("Voice recognition is not supported here. Type text and tap Translate.");
      return;
    }

    stopListening();
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = side === "left" ? leftLanguage.locale : rightLanguage.locale;
    speechBufferRef.current = "";

    recognition.onstart = function () {
      setActiveSide(side);
      setStatus("Listening… speak naturally");
      vibrate(25);
      tone();
    };

    recognition.onresult = function (event: any) {
      let live = "";
      for (let i = 0; i < event.results.length; i += 1) {
        live += event.results[i][0].transcript;
      }
      live = live.trim();
      speechBufferRef.current = live;
      if (side === "left") setLeftText(live);
      else setRightText(live);

      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(function () {
        const finalText = speechBufferRef.current.trim();
        try { recognition.stop(); } catch {}
        recognitionRef.current = null;
        setActiveSide(null);
        if (finalText) void translateText(side, finalText);
      }, 2000);
    };

    recognition.onerror = function (event: any) {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setStatus("Microphone permission is blocked. Allow microphone access or type instead.");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setStatus("Voice recognition error: " + event.error);
      }
      setActiveSide(null);
      recognitionRef.current = null;
    };

    recognition.onend = function () {
      setActiveSide(null);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setStatus("Could not start the microphone. Try again.");
      recognitionRef.current = null;
      setActiveSide(null);
    }
  }, [busySide, leftLanguage.locale, rightLanguage.locale, stopListening, tone, translateText, vibrate]);

  startListeningRef.current = startListening;

  function swapLanguages() {
    stopListening();
    setLeftLocale(rightLocale);
    setRightLocale(leftLocale);
    setLeftText(rightText);
    setRightText(leftText);
    setStatus("Languages swapped");
  }

  function saveCurrentChat() {
    if (!history.length) {
      setStatus("There is no conversation to save yet.");
      return;
    }
    const name = window.prompt("Name this conversation:", "Conversation " + new Date().toLocaleDateString());
    if (!name?.trim()) return;
    setSavedChats(function (items) {
      return [{
        id: id(),
        name: name.trim(),
        createdAt: new Date().toISOString(),
        exchanges: history
      }].concat(items);
    });
    setStatus("Conversation saved");
  }

  function clearCurrent() {
    stopListening();
    setLeftText("");
    setRightText("");
    setHistory([]);
    setStatus("New conversation ready");
  }

  function startMeeting() {
    setMeetingEntries([]);
    setMeetingStartedAt(Date.now());
    setElapsed(0);
    setStatus("Meeting transcript recording started");
    setTab("translate");
  }

  function finishMeeting() {
    if (!meetingStartedAt) return;
    const durationSec = Math.max(1, Math.floor((Date.now() - meetingStartedAt) / 1000));
    const defaultName = "Meeting " + new Date().toLocaleString();
    const name = window.prompt("Name this meeting:", defaultName) || defaultName;
    setSavedMeetings(function (items) {
      return [{
        id: id(),
        name,
        createdAt: new Date().toISOString(),
        durationSec,
        exchanges: meetingEntries
      }].concat(items);
    });
    setMeetingStartedAt(null);
    setMeetingEntries([]);
    setStatus("Meeting saved");
    setTab("meetings");
  }

  const visibleChats = savedChats.filter(function (item) {
    const value = search.toLowerCase();
    return item.name.toLowerCase().includes(value) ||
      item.exchanges.some(function (exchange) {
        return (exchange.from + " " + exchange.to + " " + exchange.source + " " + exchange.translated)
          .toLowerCase()
          .includes(value);
      });
  });

  const visibleMeetings = savedMeetings.filter(function (item) {
    const value = search.toLowerCase();
    return item.name.toLowerCase().includes(value) ||
      item.exchanges.some(function (exchange) {
        return (exchange.from + " " + exchange.to + " " + exchange.source + " " + exchange.translated)
          .toLowerCase()
          .includes(value);
      });
  });

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  function renderSpeaker(side: Side, language: Language, value: string, setValue: (value: string) => void) {
    const isActive = activeSide === side;
    const isBusy = busySide === side;
    return (
      <section className={"speaker-card " + (isActive ? "active" : "")}>
        <div className="speaker-topline">
          <span className="speaker-label">{side === "left" ? "Speaker A" : "Speaker B"}</span>
          <span className="status-dot">{isActive ? "Listening" : isBusy ? "Translating" : "Ready"}</span>
        </div>

        <label className="sr-only" htmlFor={side + "-language"}>{side + " language"}</label>
        <select
          id={side + "-language"}
          value={language.locale}
          onChange={function (event) {
            if (side === "left") setLeftLocale(event.target.value);
            else setRightLocale(event.target.value);
          }}
        >
          {LANGUAGES.map(function (item) {
            return <option key={item.locale} value={item.locale}>{item.flag + " " + item.label}</option>;
          })}
        </select>

        <textarea
          value={value}
          onChange={function (event) { setValue(event.target.value); }}
          placeholder={side === "left" ? "Speak or type here…" : "Translation appears here…"}
          rows={6}
          maxLength={1800}
        />

        <div className="speaker-actions">
          <button
            className={"mic-button " + (isActive ? "recording" : "")}
            type="button"
            onClick={function () { isActive ? stopListening() : startListening(side); }}
            aria-label={isActive ? "Stop listening" : "Start microphone"}
          >
            <span aria-hidden>{isActive ? "■" : "●"}</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!value.trim() || Boolean(busySide)}
            onClick={function () { void translateText(side, value); }}
          >
            {isBusy ? "Translating…" : "Translate"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">
            <span className="brand-mark">↔</span>
            <span>LingoSwap</span>
          </div>
          <p className="tagline">Live translation for real conversations.</p>
        </div>
        <div className="topbar-actions">
          {meetingStartedAt ? (
            <button className="meeting-live" type="button" onClick={finishMeeting}>
              <span className="pulse" /> {minutes}:{seconds} · Save meeting
            </button>
          ) : (
            <button className="ghost-button" type="button" onClick={startMeeting}>Start meeting</button>
          )}
        </div>
      </header>

      <nav className="tabs" aria-label="LingoSwap sections">
        {(["translate", "chats", "meetings", "settings"] as Tab[]).map(function (item) {
          return (
            <button
              key={item}
              type="button"
              className={tab === item ? "selected" : ""}
              onClick={function () { setTab(item); }}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          );
        })}
      </nav>

      {tab === "translate" && (
        <div className="translate-view">
          <div className="status-bar">
            <span>{status}</span>
            <span className="provider-note">Secure server translation · Browser voice</span>
          </div>

          <div className="translator-grid">
            {renderSpeaker("left", leftLanguage, leftText, setLeftText)}

            <button className="swap-button" type="button" onClick={swapLanguages} aria-label="Swap languages">⇄</button>

            {renderSpeaker("right", rightLanguage, rightText, setRightText)}
          </div>

          <div className="conversation-toolbar">
            <div>
              <strong>Live conversation</strong>
              <span>{history.length ? history.length + " exchanges" : "No exchanges yet"}</span>
            </div>
            <div className="row-actions">
              <button className="ghost-button" type="button" disabled={!history.length} onClick={saveCurrentChat}>Save chat</button>
              <button className="ghost-button" type="button" disabled={!history.length} onClick={function () {
                downloadText("lingoswap-transcript.txt", transcript(history));
              }}>Download</button>
              <button className="ghost-button" type="button" onClick={clearCurrent}>New</button>
            </div>
          </div>

          <section className="feed">
            {!history.length ? (
              <div className="empty-state">
                <span className="empty-icon">◎</span>
                <h2>Start talking</h2>
                <p>Tap a microphone, speak naturally, and LingoSwap submits after about two seconds of silence.</p>
              </div>
            ) : (
              history.slice().reverse().map(function (item) {
                return (
                  <article className="exchange" key={item.id}>
                    <div className="exchange-meta">
                      <span>{item.speaker === "left" ? "Speaker A" : "Speaker B"}</span>
                      <span>{item.at}</span>
                    </div>
                    <p className="source-text">{item.source}</p>
                    <p className="translated-text">{item.translated}</p>
                    <span className="language-path">{item.from + " → " + item.to}</span>
                  </article>
                );
              })
            )}
          </section>
        </div>
      )}

      {tab === "chats" && (
        <section className="library-view">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Conversation history</p>
              <h1>Saved chats</h1>
            </div>
            <input
              className="search"
              value={search}
              onChange={function (event) { setSearch(event.target.value); }}
              placeholder="Search chats"
              aria-label="Search saved chats"
            />
          </div>

          <div className="cards">
            {!visibleChats.length ? (
              <div className="empty-state"><h2>No saved chats</h2><p>Save a live conversation and it will appear here.</p></div>
            ) : visibleChats.map(function (chat) {
              return (
                <article className="library-card" key={chat.id}>
                  <div className="library-card-title">
                    <div>
                      <h2>{chat.name}</h2>
                      <p>{new Date(chat.createdAt).toLocaleString()} · {chat.exchanges.length} exchanges</p>
                    </div>
                  </div>
                  <p className="preview-text">{chat.exchanges[0]?.translated || "Empty conversation"}</p>
                  <div className="row-actions">
                    <button className="ghost-button" type="button" onClick={function () {
                      const next = window.prompt("Rename conversation:", chat.name);
                      if (!next?.trim()) return;
                      setSavedChats(function (items) {
                        return items.map(function (item) { return item.id === chat.id ? { ...item, name: next.trim() } : item; });
                      });
                    }}>Rename</button>
                    <button className="ghost-button" type="button" onClick={function () {
                      downloadText(chat.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".txt", transcript(chat.exchanges));
                    }}>Download</button>
                    <button className="danger-button" type="button" onClick={function () {
                      setSavedChats(function (items) { return items.filter(function (item) { return item.id !== chat.id; }); });
                    }}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "meetings" && (
        <section className="library-view">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Meeting mode</p>
              <h1>Saved meetings</h1>
            </div>
            <div className="row-actions">
              <input
                className="search"
                value={search}
                onChange={function (event) { setSearch(event.target.value); }}
                placeholder="Search meetings"
                aria-label="Search saved meetings"
              />
              {!meetingStartedAt && <button className="primary-button" type="button" onClick={startMeeting}>Start meeting</button>}
            </div>
          </div>

          <div className="notice">
            LingoSwap currently preserves meeting transcripts locally in your browser. Audio-file capture is intentionally not claimed until a reliable browser-compatible recorder is connected.
          </div>

          <div className="cards">
            {!visibleMeetings.length ? (
              <div className="empty-state"><h2>No saved meetings</h2><p>Start a meeting to collect timestamped translation exchanges.</p></div>
            ) : visibleMeetings.map(function (meeting) {
              const duration = Math.max(1, Math.round(meeting.durationSec / 60));
              return (
                <article className="library-card" key={meeting.id}>
                  <h2>{meeting.name}</h2>
                  <p>{new Date(meeting.createdAt).toLocaleString()} · about {duration} min · {meeting.exchanges.length} exchanges</p>
                  <div className="row-actions">
                    <button className="ghost-button" type="button" onClick={function () {
                      downloadText(meeting.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".txt", transcript(meeting.exchanges));
                    }}>Download transcript</button>
                    <button className="danger-button" type="button" onClick={function () {
                      setSavedMeetings(function (items) { return items.filter(function (item) { return item.id !== meeting.id; }); });
                    }}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "settings" && (
        <section className="settings-view">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Preferences</p>
              <h1>Settings</h1>
            </div>
          </div>

          <div className="settings-grid">
            <SettingRow
              title="Light theme"
              description="Switch between the default deep-navy interface and a light palette."
              checked={theme === "light"}
              onChange={function (value) { setTheme(value ? "light" : "dark"); }}
            />
            <SettingRow
              title="Auto handoff"
              description="Prepare the conversation for the opposite speaker after translated speech plays."
              checked={autoHandoff}
              onChange={setAutoHandoff}
            />
            <SettingRow
              title="Transcript logging"
              description="Keep live translation exchanges in the conversation feed and saved chats."
              checked={logTranscript}
              onChange={setLogTranscript}
            />
            <SettingRow
              title="Haptic feedback"
              description="Use supported device vibration for microphone and error feedback."
              checked={haptics}
              onChange={setHaptics}
            />
            <SettingRow
              title="Earcons"
              description="Play a short sound when listening starts or stops."
              checked={earcons}
              onChange={setEarcons}
            />
          </div>

          <div className="integration-card">
            <p className="eyebrow">Recovery status</p>
            <h2>Core translator restored</h2>
            <p>
              Voice recognition, server translation, speech playback, local chats, meetings, transcript export, themes and PWA support are restored without putting API keys in the browser.
            </p>
            <p>
              Account sync, cloud persistence, ElevenLabs/OpenAI premium TTS, Stripe trial billing and the original paywall are intentionally not faked. They should be connected only after the corresponding services and secrets are configured.
            </p>
          </div>
        </section>
      )}

      <footer>
        <span>LingoSwap recovery build</span>
        <span>Browser support for speech recognition varies by device.</span>
      </footer>
    </main>
  );
}

function SettingRow(props: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{props.title}</strong>
        <small>{props.description}</small>
      </span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={function (event) { props.onChange(event.target.checked); }}
      />
    </label>
  );
}
