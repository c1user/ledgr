// Privacy screen (blur the app in the task switcher, block screenshots of
// financial data). Configured declaratively in capacitor.config.ts
// (plugins.PrivacyScreen.enable = true) and enforced by the native shell —
// there is nothing to call from JavaScript at startup.
//
// Phase 3: if a screen needs to toggle it at runtime (e.g. allow a screenshot
// of a receipt image), wire enable()/disable() to @capacitor/privacy-screen
// behind isNative(). Until then these are documented no-ops.
import { isNative } from "./platform.js";

export const isSupported = () => isNative();

export async function enable() {
  /* Phase 3: PrivacyScreen.enable() */
}

export async function disable() {
  /* Phase 3: PrivacyScreen.disable() */
}
