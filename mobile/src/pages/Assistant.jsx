import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import cx from "@abaco/ui/cx";
import { toast } from "@abaco/ui/feedback";
import api from "../lib/api.js";
import { describeError } from "../lib/apiErrors.js";
import useEntitlements from "../lib/useEntitlements.js";
import * as haptics from "../native/haptics.js";
import { canSpeak, speak, stopSpeaking } from "../native/speech.js";
import UpsellNotice from "../components/UpsellNotice.jsx";
import MessageList from "../components/assistant/MessageList.jsx";
import Composer from "../components/assistant/Composer.jsx";
import HistorySheet from "../components/assistant/HistorySheet.jsx";
import ReportSheet from "../components/assistant/ReportSheet.jsx";
import {
  appendTranscript,
  clampMessage,
  CONVERSATIONS_QUERY_KEY,
  hasPrefill,
  prefillFromState,
  readSpeakPref,
  writeSpeakPref,
} from "../components/assistant/utils.js";

// 44px icon buttons in the page header.
const HEADER_BTN = {
  base: "flex h-11 w-11 items-center justify-center rounded-xl transition-colors active:bg-canvas",
  idle: "text-secondary",
  on: "text-brand",
};

/**
 * Assistant (ROADMAP-V6 2.9): the web's AI chat, phone-shaped. Gated on the
 * "ai_chat" entitlement (Premium) — when missing, the page shows the
 * informational UpsellNotice and nothing else (owner rule: no purchase paths
 * on the phone). A 403 UPGRADE_REQUIRED at request time flips to the same
 * view. Everything else mirrors frontend/src/pages/AiChat.jsx: POST /ai/chat
 * replaces the transcript with data.history; server errors (400 injection
 * text, 429, …) render as an assistant bubble.
 */
export default function Assistant() {
  const { t, i18n } = useTranslation();
  const lang = String(i18n.language || "en")
    .toLowerCase()
    .startsWith("es")
    ? "es"
    : "en";
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const entitlements = useEntitlements();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(() => prefillFromState(location.state, t));
  const [conversationId, setConversationId] = useState(null);
  const [upgradeBlocked, setUpgradeBlocked] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [speakOn, setSpeakOn] = useState(readSpeakPref);
  const ttsAvailable = canSpeak();

  // The prefill was consumed into the draft; drop it from history so Back
  // does not insert it again.
  useEffect(() => {
    if (hasPrefill(location.state)) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  // Leaving the screen silences "read answers aloud".
  useEffect(
    () => () => {
      stopSpeaking();
    },
    [],
  );

  // describeError's generic fallback is the login copy; the chat has its own.
  const tChat = (key, opts) =>
    t(key === "login.genericError" ? "aichat.genericError" : key, opts);

  const sendMutation = useMutation({
    mutationFn: (payload) => api.post("/ai/chat", payload).then((r) => r.data),
    onSuccess: (data) => {
      if (data?.conversationId) setConversationId(data.conversationId);
      let reply = "";
      if (Array.isArray(data?.history)) {
        setMessages(data.history);
        const last = [...data.history]
          .reverse()
          .find((m) => m?.role === "assistant");
        reply = last?.content || "";
      } else if (typeof data?.message === "string") {
        reply = data.message;
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      }
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
      if (speakOn && reply) speak(reply, lang);
    },
    onError: (err) => {
      const d = describeError(err, tChat);
      if (d.kind === "upgrade") {
        setUpgradeBlocked(true);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: d.text, error: true },
      ]);
    },
  });
  const isTyping = sendMutation.isPending;

  const handleSend = () => {
    const text = clampMessage(input.trim());
    if (!text || isTyping) return;
    haptics.tap();
    stopSpeaking();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    sendMutation.mutate({ message: text, conversationId });
  };

  const handleTranscript = (transcript) =>
    setInput((draft) => appendTranscript(draft, transcript));

  const startNew = () => {
    stopSpeaking();
    setMessages([]);
    setConversationId(null);
    setInput("");
    setHistoryOpen(false);
  };

  const loadConversation = async (conv) => {
    try {
      const { data } = await api.get(`/ai/conversations/${conv.id}`);
      stopSpeaking();
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      setConversationId(conv.id);
      setHistoryOpen(false);
    } catch {
      toast.error(t("aichat.loadError"));
    }
  };

  const handleDeleted = (id) => {
    if (id === conversationId) startNew();
  };

  const toggleSpeak = () => {
    const next = !speakOn;
    setSpeakOn(next);
    writeSpeakPref(next);
    if (!next) stopSpeaking();
  };

  const openReport = (index) => {
    const msg = messages[index];
    if (!msg || msg.role !== "assistant") return;
    setReportTarget({ text: msg.content, index, conversationId });
  };

  const gated =
    upgradeBlocked ||
    (entitlements.isSuccess && !entitlements.hasFeature("ai_chat"));
  const checking = entitlements.isPending && !upgradeBlocked;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
        <h1 className="text-lg font-semibold text-ink">
          {t("mobile.assistant.title")}
        </h1>
        {!gated && !checking && (
          <div className="flex items-center gap-1">
            {ttsAvailable && (
              <button
                type="button"
                onClick={toggleSpeak}
                aria-pressed={speakOn}
                aria-label={t("mobile.assistant.speakAnswer")}
                className={cx(
                  HEADER_BTN.base,
                  speakOn ? HEADER_BTN.on : HEADER_BTN.idle,
                )}
              >
                <i
                  className={cx(
                    "ti text-[22px]",
                    speakOn ? "ti-volume" : "ti-volume-off",
                  )}
                  aria-hidden="true"
                />
              </button>
            )}
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label={t("mobile.assistant.history")}
              aria-haspopup="dialog"
              className={cx(HEADER_BTN.base, HEADER_BTN.idle)}
            >
              <i className="ti ti-history text-[22px]" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={startNew}
              aria-label={t("mobile.assistant.newChat")}
              className={cx(HEADER_BTN.base, HEADER_BTN.idle)}
            >
              <i className="ti ti-plus text-[22px]" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {gated ? (
        <div className="px-4">
          <UpsellNotice feature="ai_chat" />
        </div>
      ) : checking ? (
        <div
          className="flex flex-1 items-center justify-center gap-2 text-md text-muted"
          role="status"
        >
          <i className="ti ti-loader-2 animate-spin" aria-hidden="true" />
          {t("mobile.common.loading")}
        </div>
      ) : (
        <>
          <MessageList
            messages={messages}
            isTyping={isTyping}
            onSuggest={(q) => setInput(clampMessage(q))}
            onReport={openReport}
          />
          <Composer
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onTranscript={handleTranscript}
            busy={isTyping}
            lang={lang}
          />
        </>
      )}

      <HistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentId={conversationId}
        onSelect={loadConversation}
        onDeleted={handleDeleted}
      />
      <ReportSheet
        target={reportTarget}
        onClose={() => setReportTarget(null)}
      />
    </div>
  );
}
