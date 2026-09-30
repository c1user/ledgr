// Privacy screen — hide financial data in the task switcher and block
// screenshots / screen recording (ROADMAP-V6 2.13 / 3.5).
//   Device: @capacitor/privacy-screen. The plugin reads NOTHING from
//           capacitor.config.ts — it is off until enable() is called, so
//           App.jsx calls enable() once at boot. Android: FLAG_SECURE +
//           dim in Recents; iOS: dark blur when the app resigns active.
//   Dev shell (VITE_DEV_SHELL=1 at build time): left off so emulator /
//           device screenshots and screen recordings keep working.
//   Web:    no-op.
import { isNative } from "./platform.js";

export const isSupported = () => isNative();

/** True for the dev-shell bundle (see mobile/README.md "Dev shell"). */
export const isDevShell = () => import.meta.env.VITE_DEV_SHELL === "1";

async function plugin() {
  const { PrivacyScreen } = await import("@capacitor/privacy-screen");
  return { PrivacyScreen }; // never resolve with the proxy itself
}

/** → true when protection is on. Idempotent; never throws. */
export async function enable() {
  if (!isNative() || isDevShell()) return false;
  try {
    const { PrivacyScreen } = await plugin();
    const { success } = await PrivacyScreen.enable({
      android: { dimBackground: true, privacyModeOnActivityHidden: "dim" },
      ios: { blurEffect: "dark" },
    });
    return success !== false;
  } catch {
    return false;
  }
}

/** For a screen that must allow a screenshot (none today). */
export async function disable() {
  if (!isNative()) return false;
  try {
    const { PrivacyScreen } = await plugin();
    await PrivacyScreen.disable();
    return true;
  } catch {
    return false;
  }
}
