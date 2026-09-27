import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@abaco/ui";
import BrandMark from "@abaco/ui/BrandMark";
import { authenticate, isSupported } from "../../native/biometrics.js";

/**
 * Full-screen privacy overlay for the biometric lock (ROADMAP-V6 2.10).
 * On a device the Face ID / fingerprint prompt opens right away; "Unlock"
 * retries after a cancel. In the browser the wrapper auto-approves, so the
 * overlay stays until the button is tapped (that is how it is verified).
 *
 * z-[400]: above the kit's Modal (z-[200]) and FeedbackHost (z-[300]) so an
 * open bottom sheet or toast never stays visible / tappable while locked.
 */
export default function LockScreen({ onUnlocked }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const attempt = useCallback(async () => {
    setFailed(false);
    setBusy(true);
    const ok = await authenticate(t("mobile.lock.useBiometrics"));
    setBusy(false);
    if (ok) onUnlocked();
    else setFailed(true);
  }, [t, onUnlocked]);

  // Device only: prompt as soon as the overlay has painted.
  useEffect(() => {
    if (!isSupported()) return undefined;
    const timer = setTimeout(attempt, 250);
    return () => clearTimeout(timer);
  }, [attempt]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("mobile.lock.title")}
      className="fixed inset-0 z-[400] flex flex-col items-center justify-center gap-6 bg-canvas px-6 text-center pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))]"
    >
      <BrandMark size={64} />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">
          {t("mobile.lock.title")}
        </h1>
        {failed && (
          <p className="text-md text-danger" role="alert">
            {t("login.genericError")}
          </p>
        )}
      </div>
      <Button
        variant="primary"
        size="lg"
        icon="ti-fingerprint"
        loading={busy}
        onClick={attempt}
        className="min-w-[200px]"
      >
        {t("mobile.lock.unlock")}
      </Button>
    </div>
  );
}
