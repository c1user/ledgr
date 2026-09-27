// Voice for the assistant: dictation into the composer and "read answers
// aloud".
//
// Dictation (start / stop / isAvailable)
//   Device: @capacitor-community/speech-recognition (published for Capacitor
//           7; peer range accepts core 8 so the JS is installed — native side
//           verified in Phase 3). // Phase 3: plugin verification
//   Web:    SpeechRecognition / webkitSpeechRecognition.
//
// Text-to-speech (speak / stopSpeaking / canSpeak)
//   Device: @capacitor-community/text-to-speech (8.0.2, peer core >=8) is NOT
//           installed yet. // Phase 3: plugin — `npm i -w mobile
//           @capacitor-community/text-to-speech@8` at the repo root, then turn
//           TTS_PACKAGE into a literal import specifier so Vite bundles it.
//           Until then the guarded import below rejects and the WebView uses
//           window.speechSynthesis, which WKWebView and Android WebView ship.
//   Web:    window.speechSynthesis.
import { isNative } from "./platform.js";

const LANG = { en: "en-US", es: "es-PR" };
const bcp47 = (lang) => LANG[lang] || lang || LANG.en;

let webRecognizer = null;

function WebRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export async function isAvailable() {
  if (isNative()) {
    try {
      const { SpeechRecognition } =
        await import("@capacitor-community/speech-recognition");
      const { available } = await SpeechRecognition.available();
      return !!available;
    } catch {
      return false;
    }
  }
  return !!WebRecognition();
}

export const isSupported = () => true;

/**
 * start({ lang: "en" | "es" }) → Promise<string transcript> ("" on nothing
 * heard / cancel). Rejects Error("permission-denied") when the microphone is
 * refused and Error("speech-unavailable") where no recognizer exists.
 */
export async function start({ lang = "en" } = {}) {
  if (isNative()) {
    const { SpeechRecognition } =
      await import("@capacitor-community/speech-recognition");
    const perm = await SpeechRecognition.requestPermissions();
    if (perm?.speechRecognition && perm.speechRecognition !== "granted") {
      throw new Error("permission-denied");
    }
    const result = await SpeechRecognition.start({
      language: bcp47(lang),
      maxResults: 1,
      partialResults: false,
      popup: false,
    });
    return result?.matches?.[0] || "";
  }

  const Ctor = WebRecognition();
  if (!Ctor) throw new Error("speech-unavailable");
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    webRecognizer = rec;
    rec.lang = bcp47(lang);
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let transcript = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (webRecognizer === rec) webRecognizer = null;
      resolve(value);
    };
    rec.onresult = (e) => {
      transcript = Array.from(e.results)
        .map((r) => r[0]?.transcript || "")
        .join(" ")
        .trim();
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        settled = true;
        if (webRecognizer === rec) webRecognizer = null;
        reject(new Error("permission-denied"));
      } else {
        // "no-speech", "aborted" (stop() before any result), "network", …
        finish(transcript);
      }
    };
    rec.onend = () => finish(transcript);
    try {
      rec.start();
    } catch {
      // A second start() while one is running throws; treat as cancel.
      finish("");
    }
  });
}

export async function stop() {
  if (isNative()) {
    try {
      const { SpeechRecognition } =
        await import("@capacitor-community/speech-recognition");
      await SpeechRecognition.stop();
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    webRecognizer?.stop();
  } catch {
    /* ignore */
  }
}

// ── Text-to-speech ────────────────────────────────────────────
const TTS_PACKAGE = "@capacitor-community/text-to-speech";

async function loadTts() {
  try {
    // Opaque to Vite on purpose (see the header note): the build must not
    // depend on a package that is not installed yet.
    const mod = await import(/* @vite-ignore */ TTS_PACKAGE);
    return mod?.TextToSpeech ? mod : null;
  } catch {
    return null;
  }
}

const synth = () =>
  typeof window !== "undefined" && window.speechSynthesis
    ? window.speechSynthesis
    : null;

/** True where speak() can do something (plugin or speechSynthesis). */
export const canSpeak = () => isNative() || !!synth();

/**
 * speak(text, "en" | "es") → Promise<boolean> (false when nothing could
 * speak). Interrupts whatever was being read.
 */
export async function speak(text, lang = "en") {
  const clean = String(text || "").trim();
  if (!clean) return false;

  if (isNative()) {
    const mod = await loadTts();
    if (mod) {
      try {
        await mod.TextToSpeech.stop();
        await mod.TextToSpeech.speak({
          text: clean,
          lang: bcp47(lang),
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          category: "ambient",
        });
        return true;
      } catch {
        /* fall through to speechSynthesis */
      }
    }
  }

  const s = synth();
  if (!s) return false;
  try {
    s.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = bcp47(lang);
    s.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export async function stopSpeaking() {
  if (isNative()) {
    const mod = await loadTts();
    try {
      await mod?.TextToSpeech.stop();
    } catch {
      /* ignore */
    }
  }
  try {
    synth()?.cancel();
  } catch {
    /* ignore */
  }
}
