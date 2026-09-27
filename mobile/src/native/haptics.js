// Haptic feedback. Device: @capacitor/haptics. Web: no-op.
import { isNative } from "./platform.js";

export const isSupported = () => isNative();

async function run(fn) {
  if (!isNative()) return;
  try {
    const mod = await import("@capacitor/haptics");
    await fn(mod);
  } catch {
    /* haptics are decoration — never surface a failure */
  }
}

export const tap = () =>
  run(({ Haptics, ImpactStyle }) =>
    Haptics.impact({ style: ImpactStyle.Light }),
  );
export const success = () =>
  run(({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Success }),
  );
export const warning = () =>
  run(({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Warning }),
  );
export const error = () =>
  run(({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Error }),
  );
