import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cx from "@abaco/ui/cx";
import { toast } from "@abaco/ui/feedback";
import * as speech from "../../native/speech.js";
import * as haptics from "../../native/haptics.js";
import { clampMessage, COUNTER_THRESHOLD, MAX_MESSAGE_CHARS } from "./utils.js";

// 1–4 rows: 24px line-height × 4 + 10px padding top and bottom.
const MAX_HEIGHT_PX = 116;
// A press held longer than this is "hold to talk": releasing stops. A shorter
// press toggles: the mic stays on until the next tap.
const HOLD_MS = 600;

const MIC = {
  idle: "border border-line bg-canvas text-secondary",
  listening: "border border-danger bg-danger-bg text-danger",
};
const SEND = {
  on: "bg-brand text-on-brand",
  off: "bg-line text-muted",
};

/**
 * The input bar at the bottom of the assistant. Lives in normal flow inside
 * the page's flex column, so the keyboard simply shrinks the list above it
 * (Capacitor Keyboard resize "native" on iOS; the browser's dvh on the web).
 * Props:
 *   value / onChange(next)      controlled draft
 *   onSend()                    send button
 *   onTranscript(text)          dictation finished (parent appends it)
 *   busy                        a reply is in flight — no send, no mic
 *   lang                        "en" | "es" → dictation language
 */
export default function Composer({
  value,
  onChange,
  onSend,
  onTranscript,
  busy = false,
  lang = "en",
}) {
  const { t } = useTranslation();
  const textareaRef = useRef(null);
  const listeningRef = useRef(false);
  const pressedAtRef = useRef(0);
  const [micAvailable, setMicAvailable] = useState(false);
  const [listening, setListening] = useState(false);

  const length = value.length;
  const canSend = value.trim().length > 0 && !busy;
  const showCounter = length > COUNTER_THRESHOLD;

  // Only offer the mic where dictation exists (Web Speech API in Chrome; the
  // plugin on device). Hidden entirely elsewhere rather than failing on tap.
  useEffect(() => {
    let alive = true;
    speech
      .isAvailable()
      .then((ok) => {
        if (alive) setMicAvailable(!!ok);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Leaving the screen mid-dictation must not leave the microphone open.
  useEffect(
    () => () => {
      if (listeningRef.current) speech.stop();
    },
    [],
  );

  // Auto-grow between one and four rows.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const beginListening = async () => {
    if (listeningRef.current || busy) return;
    listeningRef.current = true;
    setListening(true);
    haptics.tap();
    try {
      const transcript = await speech.start({ lang });
      if (transcript) onTranscript(transcript);
    } catch (err) {
      if (err?.message === "permission-denied") {
        toast.error(t("mobile.assistant.micDenied"));
      } else if (err?.message === "speech-unavailable") {
        setMicAvailable(false);
      }
    } finally {
      listeningRef.current = false;
      setListening(false);
    }
  };

  const onMicPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (listeningRef.current) {
      // Tap while listening (toggle mode) → stop.
      speech.stop();
      return;
    }
    pressedAtRef.current = Date.now();
    beginListening();
  };

  const onMicPointerUp = () => {
    // Held → release stops; a quick tap leaves the mic on (toggle mode).
    if (listeningRef.current && Date.now() - pressedAtRef.current > HOLD_MS) {
      speech.stop();
    }
  };

  const onKeyDown = (e) => {
    // Return inserts a newline on phones; Ctrl/Cmd+Return sends (desktop dev).
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="shrink-0 border-t border-line bg-surface px-3 pb-2 pt-2">
      {(listening || showCounter) && (
        <div className="mb-1.5 flex items-center justify-between px-1 text-xs">
          <span
            className={cx(
              "flex items-center gap-1.5 text-danger",
              !listening && "invisible",
            )}
            role="status"
          >
            <span
              className="h-2 w-2 animate-pulse rounded-full bg-danger"
              aria-hidden="true"
            />
            {t("mobile.assistant.listening")}
          </span>
          {showCounter && (
            <span
              className={cx(
                "tabular-nums",
                length >= MAX_MESSAGE_CHARS ? "text-danger" : "text-muted",
              )}
              aria-live="polite"
            >
              {length}/{MAX_MESSAGE_CHARS}
            </span>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        {micAvailable && (
          <button
            type="button"
            onPointerDown={onMicPointerDown}
            onPointerUp={onMicPointerUp}
            onPointerLeave={onMicPointerUp}
            onPointerCancel={onMicPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            disabled={busy}
            aria-pressed={listening}
            aria-label={
              listening
                ? t("mobile.assistant.listening")
                : t("mobile.assistant.tapToSpeak")
            }
            className={cx(
              "flex h-11 w-11 shrink-0 select-none touch-none items-center justify-center rounded-full transition-colors disabled:opacity-60",
              listening ? MIC.listening : MIC.idle,
            )}
          >
            <i
              className={cx(
                "ti text-[20px]",
                listening ? "ti-player-stop" : "ti-microphone",
              )}
              aria-hidden="true"
            />
          </button>
        )}

        <div className="flex min-w-0 flex-1 items-end rounded-2xl border border-line bg-canvas px-3 transition-colors focus-within:border-brand">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            maxLength={MAX_MESSAGE_CHARS}
            onChange={(e) => onChange(clampMessage(e.target.value))}
            onKeyDown={onKeyDown}
            placeholder={t("mobile.assistant.placeholder")}
            aria-label={t("mobile.assistant.placeholder")}
            autoCapitalize="sentences"
            enterKeyHint="enter"
            className="max-h-[116px] w-full resize-none overflow-y-auto bg-transparent py-2.5 text-base leading-6 text-ink outline-none placeholder:text-muted"
          />
        </div>

        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={t("mobile.assistant.send")}
          className={cx(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed",
            canSend ? SEND.on : SEND.off,
          )}
        >
          <i className="ti ti-send text-[20px]" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
