import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation, Trans } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import dayjs from "dayjs";
import cx from "../lib/cx";
import { Button, Card } from "../components/ui";

const SUGGESTED_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"];

// Round avatar with a tabler icon, used by chat bubbles.
function Avatar({ icon }) {
  return (
    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-brand-light shrink-0 mt-0.5">
      <i className={cx("ti", icon, "text-sm text-brand")} aria-hidden="true" />
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div
      className={cx(
        "flex mb-4",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div className="mr-2">
          <Avatar icon="ti-sparkles" />
        </div>
      )}
      <div
        className={cx(
          "max-w-[75%] px-3.5 py-2.5 text-md leading-[1.7] whitespace-pre-wrap",
          isUser
            ? "rounded-xl rounded-br-sm bg-brand text-white"
            : "rounded-xl rounded-bl-sm bg-canvas text-ink border border-line",
        )}
      >
        {msg.content}
      </div>
      {isUser && (
        <div className="ml-2">
          <Avatar icon="ti-user" />
        </div>
      )}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Avatar icon="ti-sparkles" />
      <div className="flex items-center gap-1 px-3.5 py-2.5 rounded-xl rounded-bl-sm bg-canvas border border-line">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main AI Chat Page ─────────────────────────────────────────
export default function AiChat() {
  const { t } = useTranslation();
  const { business } = useAuthStore();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [panelError, setPanelError] = useState("");
  const bottomRef = useRef();
  const inputRef = useRef();

  // Fetch conversation history
  const { data: conversations } = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: () => api.get("/ai/conversations").then((r) => r.data),
  });

  // Auto scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const sendMutation = useMutation({
    mutationFn: (data) => api.post("/ai/chat", data),
    onSuccess: (res) => {
      const data = res.data;
      setConversationId(data.conversationId);
      // Defensive: never trust the API shape blindly.
      if (Array.isArray(data.history)) {
        setMessages(data.history);
      } else if (typeof data.message === "string") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.message },
        ]);
      }
      setIsTyping(false);
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
    onError: (err) => {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: err.response?.data?.error || t("aichat.genericError"),
        },
      ]);
    },
  });

  const handleSend = () => {
    const text = input.trim();
    if (!text || isTyping) return;
    setInput("");
    setIsTyping(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    sendMutation.mutate({ message: text, conversationId });
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (q) => {
    setInput(q);
    inputRef.current?.focus();
  };

  const loadConversation = async (conv) => {
    setPanelError("");
    try {
      const { data } = await api.get(`/ai/conversations/${conv.id}`);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setConversationId(conv.id);
      setShowHistory(false);
    } catch (err) {
      console.error("Load conversation failed:", err);
      setPanelError(t("aichat.loadError"));
    }
  };

  const startNew = () => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    setPanelError("");
    try {
      await api.delete(`/ai/conversations/${id}`);
      queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
      if (conversationId === id) startNew();
    } catch (err) {
      console.error("Delete conversation failed:", err);
      setPanelError(t("aichat.deleteError"));
    }
  };

  return (
    <div className="fade-in flex flex-col h-[calc(100vh-52px-48px)]">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-ink mb-1">
            {t("aichat.title")}
          </h1>
          <div className="text-md text-muted">
            <Trans
              i18nKey="aichat.subtitle"
              values={{ name: business?.name }}
              components={{
                strong: <strong className="text-secondary" />,
              }}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            icon="ti-history"
            onClick={() => setShowHistory(!showHistory)}
          >
            {t("aichat.history")}
          </Button>
          <Button icon="ti-plus" onClick={startNew}>
            {t("aichat.newChat")}
          </Button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Chat area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Messages */}
          <Card padding="none" className="flex-1 overflow-y-auto p-5 mb-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-brand-light mb-4">
                  <i
                    className="ti ti-sparkles text-[28px] text-brand"
                    aria-hidden="true"
                  />
                </div>
                <div className="text-base font-medium text-ink mb-1.5">
                  {t("aichat.emptyTitle")}
                </div>
                <div className="text-md text-muted mb-6 max-w-[360px]">
                  {t("aichat.emptySubtitle")}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-[500px]">
                  {SUGGESTED_KEYS.map((key) => {
                    const q = t(`aichat.suggested.${key}`);
                    return (
                      <button
                        key={key}
                        onClick={() => handleSuggestion(q)}
                        className="px-3 py-2.5 rounded-lg border border-line bg-canvas text-secondary cursor-pointer text-xs text-left leading-snug transition-all hover:border-brand hover:text-brand"
                      >
                        {q}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <Message key={i} msg={msg} />
                ))}
                {isTyping && <TypingIndicator />}
                <div ref={bottomRef} />
              </>
            )}
          </Card>

          {/* Input bar */}
          <Card
            padding="none"
            className="flex gap-2.5 items-end px-3.5 py-2.5 shrink-0"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("aichat.inputPlaceholder")}
              rows={1}
              className="flex-1 border-none bg-transparent text-ink text-md font-sans resize-none outline-none leading-relaxed max-h-[120px] overflow-auto placeholder:text-muted"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={cx(
                "flex items-center justify-center w-[34px] h-[34px] rounded-lg shrink-0 transition-colors",
                input.trim() && !isTyping
                  ? "bg-brand text-white cursor-pointer"
                  : "bg-line text-muted cursor-not-allowed",
              )}
            >
              <i className="ti ti-send text-base" aria-hidden="true" />
            </button>
          </Card>
          <div className="text-[11px] text-muted mt-1.5 text-center">
            {t("aichat.footer")}
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
          <Card
            padding="none"
            className="w-[260px] overflow-hidden shrink-0 flex flex-col"
          >
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-line text-md font-medium text-ink">
              {t("aichat.pastConversations")}
              <button
                onClick={() => setShowHistory(false)}
                className="text-base text-muted cursor-pointer"
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            {panelError && (
              <div className="px-4 py-2 text-xs text-danger border-b border-line">
                {panelError}
              </div>
            )}
            <div className="overflow-y-auto flex-1">
              {!conversations?.length ? (
                <div className="p-5 text-center text-muted text-md">
                  {t("aichat.noPastConversations")}
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => loadConversation(conv)}
                    className="flex justify-between items-start px-4 py-3 border-b border-line cursor-pointer transition-colors hover:bg-canvas"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-ink font-medium truncate mb-0.5">
                        {conv.first_message || t("aichat.newConversation")}
                      </div>
                      <div className="text-[11px] text-muted">
                        {dayjs(conv.updated_at).format("MMM D, YYYY")}
                      </div>
                    </div>
                    <button
                      onClick={(e) => deleteConversation(conv.id, e)}
                      className="px-1 py-0.5 shrink-0 ml-1.5 text-danger cursor-pointer"
                    >
                      <i className="ti ti-trash text-md" aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
