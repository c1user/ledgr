import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { FeedbackHost } from "@abaco/ui/feedback";
import useAuthStore from "./store/authStore.js";
import usePrefsStore from "./store/prefsStore.js";
import useThemeStore from "./store/themeStore.js";
import { onBackButton, onResume } from "./native/appLifecycle.js";
import { enable as enablePrivacyScreen } from "./native/privacy.js";
import { hide as hideNativeSplash } from "./native/splash.js";
import { handleBackButton } from "./lib/backButton.js";
import { markBackgrounded, markUnlocked, shouldLock } from "./lib/lockGate.js";
import { useReminderScheduler } from "./lib/reminders.js";
import RequireAuth from "./components/RequireAuth.jsx";
import Shell from "./components/Shell.jsx";
import Splash from "./components/Splash.jsx";
import LockScreen from "./components/settings/LockScreen.jsx";
import Login from "./pages/Login.jsx";
import Mfa from "./pages/Mfa.jsx";
import UpdateRequired from "./pages/UpdateRequired.jsx";
import Scan from "./pages/Scan.jsx";
import Receipts from "./pages/Receipts.jsx";
import ReceiptDetail from "./pages/ReceiptDetail.jsx";
import ReceiptReview from "./pages/ReceiptReview.jsx";
import Assistant from "./pages/Assistant.jsx";
import Settings from "./pages/Settings.jsx";

/** Hide the native splash even if hydrate() never settles (offline DNS hang…). */
export const SPLASH_WATCHDOG_MS = 6000;

/**
 * Biometric lock (ROADMAP-V6 2.10). Mounted only while signed in and the
 * setting is on. The decision lives in lib/lockGate.js: a cold start locks
 * until the first unlock; afterwards the app locks when it comes back after
 * prefsStore.lockAfterMinutes in the background.
 */
function LockGate() {
  const lockAfterMinutes = usePrefsStore((s) => s.lockAfterMinutes);
  const [locked, setLocked] = useState(() =>
    shouldLock(undefined, { enabled: true, lockAfterMinutes }),
  );

  useEffect(() => {
    const evaluate = () => {
      if (shouldLock(Date.now(), { enabled: true, lockAfterMinutes })) {
        setLocked(true);
      }
    };
    // Leaving the foreground: the WebView fires visibilitychange on both
    // platforms and in the browser. (Phase 3: also wire @capacitor/app
    // "pause" through native/appLifecycle.js for iOS reliability.)
    const onVisibility = () => {
      if (document.visibilityState === "hidden") markBackgrounded(Date.now());
      else evaluate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = onResume(evaluate);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [lockAfterMinutes]);

  if (!locked) return null;
  return (
    <LockScreen
      onUnlocked={() => {
        markUnlocked();
        setLocked(false);
      }}
    />
  );
}

/** Local reminders (2.12): mounted while signed in and the toggle is on. */
function ReminderScheduler() {
  useReminderScheduler();
  return null;
}

function Boot() {
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  const biometricLock = usePrefsStore((s) => s.biometricLock);
  const remindersEnabled = usePrefsStore((s) => s.remindersEnabled);
  const navigate = useNavigate();

  // Theme + session, once. hydrate() is idempotent while in flight, so the
  // StrictMode double-invoke is harmless.
  useEffect(() => {
    useThemeStore.getState().apply();
    hydrate().catch(() => {
      // hydrate() guards its own steps; this is the last line of defence so
      // an unexpected throw can never leave the app on the boot splash.
      useAuthStore.setState({ status: "anon" });
    });
  }, [hydrate]);

  // Privacy screen (2.13): blur / block screenshots from the first frame on.
  // The plugin ignores capacitor.config.ts, so it is switched on here (no-op
  // on the web and in the dev shell — see native/privacy.js).
  useEffect(() => {
    enablePrivacyScreen();
  }, []);

  // Android Back (3.2) — see lib/backButton.js. Registered ONCE: `navigate`
  // changes identity on every route change (react-router 7), and re-adding
  // the native listener per navigation briefly leaves two of them live —
  // two Escapes, or two history.back() steps.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  useEffect(
    () =>
      onBackButton(() =>
        handleBackButton({
          navigate: (...args) => navigateRef.current(...args),
        }),
      ),
    [],
  );

  // Resume watchdog: a token that died while the app slept flips to expired.
  useEffect(() => onResume(() => useAuthStore.getState().checkToken()), []);

  // Native launch splash (3.1): capacitor.config.ts has launchAutoHide: false,
  // so the system splash stays up — and the activity draws nothing — until we
  // hide it. Do that once hydrate() has settled on ANY status (authed, anon,
  // expired, update-required); a watchdog hides it anyway if hydration hangs
  // (the in-app <Splash /> keeps the screen covered). No-op on the web.
  useEffect(() => {
    if (status !== "booting") {
      hideNativeSplash();
      return undefined;
    }
    const watchdog = setTimeout(hideNativeSplash, SPLASH_WATCHDOG_MS);
    return () => clearTimeout(watchdog);
  }, [status]);

  // Redirect on the TRANSITION into expired / update-required only. `navigate`
  // gets a new identity on every pathname change (react-router 7), so a
  // status-only check here would bounce every later navigation — e.g.
  // Login → /mfa while status is still "expired" — back to the login form.
  const prevStatus = useRef(status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (status === prev) return;
    if (status === "expired") navigate("/login?expired=1", { replace: true });
    if (status === "update-required") {
      navigate("/update-required", { replace: true });
    }
  }, [status, navigate]);

  if (status === "booting") return <Splash />;

  const authed = status === "authed";

  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/mfa" element={<Mfa />} />
        <Route path="/update-required" element={<UpdateRequired />} />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/scan" replace />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/receipts" element={<Receipts />} />
          <Route path="/receipts/:id" element={<ReceiptDetail />} />
          <Route path="/receipts/:id/review" element={<ReceiptReview />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/scan" replace />} />
      </Routes>
      {authed && biometricLock && <LockGate />}
      {authed && remindersEnabled && <ReminderScheduler />}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Boot />
      <FeedbackHost />
    </BrowserRouter>
  );
}
