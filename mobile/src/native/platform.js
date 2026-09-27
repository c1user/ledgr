// The only module outside native/ wrappers that anything may ask "am I on a
// device?". Every other wrapper in this folder branches on isNative() and
// falls back to a web implementation so the app runs in Chrome (375×812)
// against the local backend during development.
import { Capacitor } from "@capacitor/core";

export const isNative = () => Capacitor.isNativePlatform();

/** "ios" | "android" | "web" */
export const platform = () => Capacitor.getPlatform();
export const isIOS = () => platform() === "ios";
export const isAndroid = () => platform() === "android";

/** Converts a native file path (file://…) into a URL the WebView can load. */
export const toWebUrl = (path) =>
  isNative() ? Capacitor.convertFileSrc(path) : path;

export const isSupported = () => true;
