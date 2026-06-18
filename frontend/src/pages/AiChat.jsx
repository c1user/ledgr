import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation, Trans } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import dayjs from "dayjs";

const SUGGESTED_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"];

// ── Message bubble ────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 16,
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--brand-light)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginRight: 8,
            marginTop: 2,
          }}
        >
          <i
            className="ti ti-sparkles"
            style={{ fontSize: 14, color: "var(--brand)" }}
            aria-hidden="true"
          />
        </div>
      )}
      <div
        style={{
          maxWidth: "75%",
          padding: "10px 14px",
          borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
          background: isUser ? "var(--brand)" : "var(--bg-secondary)",
          color: isUser ? "#fff" : "var(--text-primary)",
          fontSize: 13,
          lineHeight: 1.7,
          border: isUser ? "none" : "0.5px solid var(--border-color)",
          whiteSpace: "pre-wrap",
        }}
      >
        {msg.content}
      </div>
      {isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--brand-light)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginLeft: 8,
            marginTop: 2,
          }}
        >
          <i
            className="ti ti-user"
            style={{ fontSize: 14, color: "var(--brand)" }}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────
function TypingIndicator() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--brand-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <i
          className="ti ti-sparkles"
          style={{ fontSize: 14, color: "var(--brand)" }}
          aria-hidden="true"
        />
      </div>
      <div
        style={{
          padding: "10px 14px",
          borderRadius: "12px 12px 12px 2px",
          background: "var(--bg-secondary)",
          border: "0.5px solid var(--border-color)",
          display: "flex",
          gap: 4,
          alignItems: "center",
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--text-muted)",
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
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
    <div
      className="fade-in"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 52px - 48px)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 4,
            }}
          >
            {t("aichat.title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            <Trans
              i18nKey="aichat.subtitle"
              values={{ name: business?.name }}
              components={{
                strong: <strong style={{ color: "var(--text-secondary)" }} />,
              }}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowHistory(!showHistory)}
          >
            <i className="ti ti-history" aria-hidden="true" />{" "}
            {t("aichat.history")}
          </button>
          <button className="btn btn-secondary" onClick={startNew}>
            <i className="ti ti-plus" aria-hidden="true" />{" "}
            {t("aichat.newChat")}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        {/* Chat area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {/* Messages */}
          <div
            className="card"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px",
              marginBottom: 12,
            }}
          >
            {messages.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "var(--brand-light)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <i
                    className="ti ti-sparkles"
                    style={{ fontSize: 28, color: "var(--brand)" }}
                    aria-hidden="true"
                  />
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    marginBottom: 6,
                  }}
                >
                  {t("aichat.emptyTitle")}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    marginBottom: 24,
                    maxWidth: 360,
                  }}
                >
                  {t("aichat.emptySubtitle")}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    width: "100%",
                    maxWidth: 500,
                  }}
                >
                  {SUGGESTED_KEYS.map((key) => {
                    const q = t(`aichat.suggested.${key}`);
                    return (
                      <button
                        key={key}
                        onClick={() => handleSuggestion(q)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "0.5px solid var(--border-color)",
                          background: "var(--bg-secondary)",
                          color: "var(--text-secondary)",
                          cursor: "pointer",
                          fontSize: 12,
                          textAlign: "left",
                          lineHeight: 1.4,
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--brand)";
                          e.currentTarget.style.color = "var(--brand)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor =
                            "var(--border-color)";
                          e.currentTarget.style.color = "var(--text-secondary)";
                        }}
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
          </div>

          {/* Input bar */}
          <div
            className="card"
            style={{
              padding: "10px 14px",
              display: "flex",
              gap: 10,
              alignItems: "flex-end",
              flexShrink: 0,
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("aichat.inputPlaceholder")}
              rows={1}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: 13,
                fontFamily: "inherit",
                resize: "none",
                outline: "none",
                lineHeight: 1.6,
                maxHeight: 120,
                overflow: "auto",
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background:
                  input.trim() && !isTyping
                    ? "var(--brand)"
                    : "var(--border-color)",
                border: "none",
                cursor: input.trim() && !isTyping ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.15s",
              }}
            >
              <i
                className="ti ti-send"
                style={{
                  fontSize: 16,
                  color:
                    input.trim() && !isTyping ? "#fff" : "var(--text-muted)",
                }}
                aria-hidden="true"
              />
            </button>
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 6,
              textAlign: "center",
            }}
          >
            {t("aichat.footer")}
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
          <div
            className="card"
            style={{
              width: 260,
              padding: 0,
              overflow: "hidden",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "0.5px solid var(--border-color)",
                fontSize: 13,
                fontWeight: 500,
                color: "var(--text-primary)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              {t("aichat.pastConversations")}
              <button
                onClick={() => setShowHistory(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: 16,
                }}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            {panelError && (
              <div
                style={{
                  padding: "8px 16px",
                  fontSize: 12,
                  color: "var(--danger)",
                  borderBottom: "0.5px solid var(--border-color)",
                }}
              >
                {panelError}
              </div>
            )}
            <div style={{ overflowY: "auto", flex: 1 }}>
              {!conversations?.length ? (
                <div
                  style={{
                    padding: 20,
                    textAlign: "center",
                    color: "var(--text-muted)",
                    fontSize: 13,
                  }}
                >
                  {t("aichat.noPastConversations")}
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => loadConversation(conv)}
                    style={{
                      padding: "12px 16px",
                      borderBottom: "0.5px solid var(--border-color)",
                      cursor: "pointer",
                      transition: "background 0.15s",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--bg-secondary)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-primary)",
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginBottom: 3,
                        }}
                      >
                        {conv.first_message || t("aichat.newConversation")}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {dayjs(conv.updated_at).format("MMM D, YYYY")}
                      </div>
                    </div>
                    <button
                      onClick={(e) => deleteConversation(conv.id, e)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--danger)",
                        padding: "2px 4px",
                        flexShrink: 0,
                        marginLeft: 6,
                      }}
                    >
                      <i
                        className="ti ti-trash"
                        style={{ fontSize: 13 }}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
