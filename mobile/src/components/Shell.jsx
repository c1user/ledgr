import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BrandMark from "@abaco/ui/BrandMark";
import { BRAND } from "@abaco/tokens/brand.js";
import useAuthStore from "../store/authStore.js";
import useOutboxStore, { selectOutboxCount } from "../store/outboxStore.js";
import { onShareEvent } from "../native/shareIntake.js";
import {
  onShortcut,
  register as registerShortcuts,
} from "../native/shortcuts.js";
import TabBar from "./TabBar.jsx";
import OfflineBanner from "./OfflineBanner.jsx";

/** Home-screen quick actions (long-press the app icon) → routes. */
const SHORTCUTS = [
  { id: "scan", to: "/scan", titleKey: "mobile.scan.scanReceipt" },
  { id: "assistant", to: "/assistant", titleKey: "mobile.assistant.title" },
];

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
  // `navigate` gets a new identity on every route change (react-router 7);
  // the native listeners below must not be re-registered each time.
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // Offline outbox (2.11): wire the launch / network / resume triggers once,
  // whichever tab the app opens on. start() is idempotent (Scan calls it too).
  useEffect(() => {
    useOutboxStore.getState().start();
  }, []);

  // App shortcuts (2.13): registered with the current language while signed
  // in (again when the language changes — `t` is stable otherwise); a tap on
  // one routes to its screen. No-op on the web.
  useEffect(() => {
    registerShortcuts(
      SHORTCUTS.map(({ id, titleKey }) => ({ id, title: t(titleKey) })),
    );
    return onShortcut((id) => {
      const target = SHORTCUTS.find((s) => s.id === id);
      if (target) navigateRef.current(target.to);
    });
  }, [t]);

  // Share-sheet intake (2.6): a share that lands while another tab is up
  // switches to Scan, whose subscription pulls the files and opens the
  // CaptureSheet. Already on Scan → its own listener handles it.
  useEffect(
    () =>
      onShareEvent(() => {
        if (window.location.pathname !== "/scan") navigateRef.current("/scan");
      }),
    [],
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
