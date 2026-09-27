// Home-screen quick actions (long-press the app icon: "Scan a receipt").
//   Device: @capawesome/capacitor-app-shortcuts. Web: no-op.
import { isNative } from "./platform.js";

export const isSupported = () => isNative();

/** register([{ id, title, description?, icon? }]) */
export async function register(items) {
  if (!isNative()) return false;
  try {
    const { AppShortcuts } =
      await import("@capawesome/capacitor-app-shortcuts");
    await AppShortcuts.set({
      shortcuts: items.map(({ id, title, description, icon }) => ({
        id,
        title,
        description,
        icon,
      })),
    });
    return true;
  } catch {
    return false;
  }
}

/** onShortcut(cb) → unsubscribe. cb(shortcutId) */
export function onShortcut(cb) {
  if (!isNative()) return () => {};
  let handle = null;
  let cancelled = false;
  import("@capawesome/capacitor-app-shortcuts")
    .then(({ AppShortcuts }) =>
      AppShortcuts.addListener("click", ({ shortcutId }) => cb(shortcutId)),
    )
    .then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    handle?.remove();
  };
}
