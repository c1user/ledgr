// useOnline() → boolean. The OfflineBanner's probe-then-subscribe logic as a
// reusable hook for screens that disable network-only actions while the
// device has no connection (ROADMAP-V6 2.15: the CSV import/export CTAs —
// neither is queued, so they are simply unavailable offline).
//
// Optimistic: starts true so a flash of "offline" never precedes the first
// probe; `isOnline()` settles it and every `onChange` event flips it. Built
// on native/network.js, so the device uses @capacitor/network and the
// browser navigator.onLine + the online/offline events.
import { useEffect, useState } from "react";
import { isOnline, onChange } from "../native/network.js";

export function useOnline() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    isOnline()
      .then((v) => alive && setOnline(v))
      .catch(() => {});
    const unsub = onChange((v) => alive && setOnline(v));
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return online;
}

export default useOnline;
