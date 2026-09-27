// Opens a URL outside the app (Abaco on the web, Terms, Privacy).
//   Device: @capacitor/browser (SFSafariViewController / Custom Tabs).
//   Web:    window.open in a new tab.
import { isNative } from "./platform.js";

export const isSupported = () => true;

export async function openExternal(url) {
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
