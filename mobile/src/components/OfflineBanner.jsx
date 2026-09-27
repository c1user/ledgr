import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isOnline, onChange } from "../native/network.js";

/** Thin strip under the header while the device has no connection. */
export default function OfflineBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    isOnline().then((v) => alive && setOnline(v));
    const unsub = onChange((v) => alive && setOnline(v));
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  if (online) return null;
  return (
    <div
      className="flex items-center gap-2 bg-sunken px-4 py-1.5 text-xs text-secondary border-b border-line"
      role="status"
    >
      <i className="ti ti-wifi-off text-sm" aria-hidden="true" />
      <span className="font-medium text-ink">{t("mobile.common.offline")}</span>
      <span className="truncate">{t("mobile.common.offlineHint")}</span>
    </div>
  );
}
