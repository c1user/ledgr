import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import cx from "@abaco/ui/cx";
import useLongPress from "./useLongPress.js";
import { SUGGESTED_KEYS } from "./utils.js";

// Bubble looks are the web's (frontend/src/pages/AiChat.jsx) so both apps
// read as one product.
const BUBBLE = {
  user: "rounded-xl rounded-br-sm bg-brand text-on-brand",
  assistant: "rounded-xl rounded-bl-sm bg-canvas text-ink border border-line",
};

// iOS shows a copy/share callout on long-press; the gesture opens the report
// sheet instead. (Not a Tailwind utility, hence inline.)
const NO_CALLOUT = { WebkitTouchCallout: "none" };

function Avatar({ icon }) {
  return (
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light">
      <i className={cx("ti text-sm text-brand", icon)} aria-hidden="true" />
    </div>
  );
}

function Bubble({ msg, index, onReport }) {
  const { t } = useTranslation();
  const isUser = msg.role === "user";
  // Error bubbles carry the server's text, not an answer — nothing to report.
  const reportable = !isUser && !msg.error && typeof onReport === "function";
  const longPress = useLongPress(() => {
    if (reportable) onReport(index);
  });

  return (
    <div
      className={cx(
        "mb-4 flex items-start gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && <Avatar icon="ti-sparkles" />}
      <div
        {...(reportable ? longPress : {})}
        style={reportable ? NO_CALLOUT : undefined}
        className={cx(
          "max-w-[80%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-md leading-[1.7]",
          reportable && "select-none",
          isUser ? BUBBLE.user : BUBBLE.assistant,
        )}
      >
        {msg.content}
      </div>
      {reportable && (
        <button
          type="button"
          onClick={() => onReport(index)}
          aria-label={t("mobile.assistant.report.title")}
          aria-haspopup="dialog"
          className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-full text-muted transition-colors active:bg-canvas"
        >
          <i className="ti ti-dots text-base" aria-hidden="true" />
        </button>
      )}
      {isUser && <Avatar icon="ti-user" />}
    </div>
  );
}

function TypingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex items-center gap-2" role="status">
      <Avatar icon="ti-sparkles" />
      <div className="flex items-center gap-1 rounded-xl rounded-bl-sm border border-line bg-canvas px-3.5 py-2.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <span className="sr-only">{t("mobile.assistant.thinking")}</span>
    </div>
  );
}

function EmptyConversation({ onSuggest }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-1 py-2 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-light">
        <i
          className="ti ti-sparkles text-[28px] text-brand"
          aria-hidden="true"
        />
      </div>
      <div className="mb-1.5 text-base font-medium text-ink">
        {t("aichat.emptyTitle")}
      </div>
      <p className="mb-5 text-md text-muted">
        {t("mobile.assistant.subtitle")}
      </p>
      <div className="grid w-full grid-cols-1 gap-2">
        {SUGGESTED_KEYS.map((key) => {
          const q = t(`aichat.suggested.${key}`);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSuggest(q)}
              className="min-h-[44px] rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-md leading-snug text-secondary transition-colors active:border-brand active:text-brand"
            >
              {q}
            </button>
          );
        })}
      </div>
      <p className="mt-5 text-[11px] text-muted">
        {t("mobile.assistant.footer")}
      </p>
    </div>
  );
}

/**
 * The scrolling transcript. Props:
 *   messages  [{ role: "user" | "assistant", content, error? }]
 *   isTyping  show the three-dot indicator after the last message
 *   onSuggest(question)  a suggested-question chip was tapped
 *   onReport(index)      "…" / long-press on an assistant bubble
 */
export default function MessageList({
  messages,
  isTyping,
  onSuggest,
  onReport,
}) {
  const scrollRef = useRef(null);

  // Stick to the bottom as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3"
    >
      {messages.length === 0 && !isTyping ? (
        <EmptyConversation onSuggest={onSuggest} />
      ) : (
        <>
          {messages.map((msg, i) => (
            <Bubble key={i} msg={msg} index={i} onReport={onReport} />
          ))}
          {isTyping && <TypingIndicator />}
        </>
      )}
    </div>
  );
}
