// Native launch splash (ROADMAP-V6 3.1).
//   Device: @capacitor/splash-screen. capacitor.config.ts sets
//           launchAutoHide: false, so on Android 12+ the plugin keeps the
//           SYSTEM splash window on screen (setKeepOnScreenCondition) and the
//           activity never draws a frame until hide() is called — App.jsx
//           calls it as soon as the auth store leaves "booting" (the in-app
//           <Splash /> is already painted underneath, so there is no flash).
//   Web:    no-op.
import { isNative } from "./platform.js";

export const isSupported = () => isNative();

/** Fade the native splash out; the in-app boot splash is visible beneath it. */
export const FADE_OUT_MS = 200;

let hidden = false;

/** Idempotent: hides once per page load, never throws. → true when it ran. */
export async function hide() {
  if (!isNative() || hidden) return false;
  hidden = true;
  try {
    // Destructure inside: never hand a plugin proxy to `await` (its .then()
    // would be called natively — see secureStorage.js).
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: FADE_OUT_MS });
    return true;
  } catch {
    return false;
  }
}

/** Test hook. */
export const _reset = () => {
  hidden = false;
};
