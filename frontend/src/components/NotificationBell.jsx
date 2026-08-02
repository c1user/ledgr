import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import cx from "../lib/cx";

// Header bell: unread badge + dropdown of the latest notifications
// (V3 Phase 8). Polls softly — events land within a minute.
export default function NotificationBell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const { data, dataUpdatedAt } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications").then((r) => r.data),
    refetchInterval: 60_000,
  });
  const items = data?.notifications || [];
  const unread = data?.unreadCount || 0;

  const markRead = useMutation({
    mutationFn: (payload) =>
      api.post("/notifications/mark-read", payload).then((r) => r.data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Ages are relative to the last fetch (dataUpdatedAt) — a pure input that
  // refreshes with each poll, unlike Date.now() in render.
  const timeAgo = (iso) => {
    const mins = Math.max(0, Math.floor((dataUpdatedAt - new Date(iso)) / 60000));
    if (mins < 1) return t("notif.justNow");
    if (mins < 60) return t("notif.minutesAgo", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("notif.hoursAgo", { n: hours });
    return new Date(iso).toLocaleDateString(
      i18n.language === "es" ? "es-PR" : "en-US",
      { month: "short", day: "numeric" },
    );
  };

  const openItem = (n) => {
    if (!n.read_at) markRead.mutate({ id: n.id });
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={t("notif.title")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex items-center justify-center w-7 h-7 rounded-md text-secondary hover:text-ink hover:bg-canvas cursor-pointer"
      >
        <i className="ti ti-bell text-lg" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-expense text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-[160] w-80 bg-surface border border-line rounded-card shadow-card fade-in">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-line">
              <span className="text-xs font-semibold text-ink">
                {t("notif.title")}
              </span>
              {unread > 0 && (
                <button
                  onClick={() => markRead.mutate({ all: true })}
                  className="text-[11px] text-brand font-medium cursor-pointer"
                >
                  {t("notif.markAllRead")}
                </button>
              )}
            </div>

            <div className="max-h-[360px] overflow-y-auto py-1">
              {items.length === 0 ? (
                <div className="px-3.5 py-8 text-center text-muted text-md">
                  <i className="ti ti-bell-off text-xl block mb-1.5" aria-hidden="true" />
                  {t("notif.empty")}
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={cx(
                      "w-full text-left px-3.5 py-2.5 hover:bg-canvas cursor-pointer border-b border-line last:border-b-0",
                      !n.read_at && "bg-brand-light/40",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read_at && (
                        <span className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-md text-ink leading-snug">
                          {n.title}
                        </div>
                        {n.body && (
                          <div className="text-xs text-secondary truncate mt-0.5">
                            {n.body}
                          </div>
                        )}
                        <div className="text-[11px] text-muted mt-0.5">
                          {timeAgo(n.created_at)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
