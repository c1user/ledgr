import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BrandMark from "@abaco/ui/BrandMark";
import { BRAND } from "@abaco/tokens/brand.js";
import useAuthStore from "../store/authStore.js";
import useOutboxStore, { selectOutboxCount } from "../store/outboxStore.js";
import { onShareEvent } from "../native/shareIntake.js";
import TabBar from "./TabBar.jsx";
import OfflineBanner from "./OfflineBanner.jsx";

/**
 * Authenticated app frame: 52px header (mark + wordmark + business name),
 * scrollable <main> with the routed page, bottom TabBar. The header carries
 * the top safe-area inset (notch / Dynamic Island); the TabBar the bottom one.
 */
export default function Shell() {
  const { t } = useTranslation();
  const business = useAuthStore((s) => s.business);
  const expiresSoon = useAuthStore((s) => s.expiresSoon);
  const outboxCount = useOutboxStore(selectOutboxCount);
  const navigate = useNavigate();

  // Offline outbox (2.11): wire the launch / network / resume triggers once,
  // whichever tab the app opens on. start() is idempotent (Scan calls it too).
  useEffect(() => {
    useOutboxStore.getState().start();
  }, []);

  // Share-sheet intake (2.6): a share that lands while another tab is up
  // switches to Scan, whose subscription pulls the files and opens the
  // CaptureSheet. Already on Scan → its own listener handles it.
  useEffect(
    () =>
      onShareEvent(() => {
        if (window.location.pathname !== "/scan") navigate("/scan");
      }),
    [navigate],
  );

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="shrink-0 bg-surface border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="flex h-[52px] items-center gap-2.5 px-4">
          <BrandMark size={24} className="shrink-0" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-display text-brand text-[15px] font-bold tracking-[3px] uppercase">
              {BRAND.name}
            </div>
            {business?.name && (
              <div className="text-muted text-[11px] truncate">
                {business.name}
              </div>
            )}
          </div>
        </div>
        <OfflineBanner />
        {expiresSoon && (
          <div
            className="bg-sunken px-4 py-1.5 text-xs text-secondary border-b border-line"
            role="status"
          >
            {t("mobile.common.sessionEndsSoon")}
          </div>
        )}
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
        <Outlet />
      </main>

      <TabBar badges={{ "/scan": outboxCount }} />
    </div>
  );
}
