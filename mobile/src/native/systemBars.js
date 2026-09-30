// Status / navigation bar content colour (ROADMAP-V6 3.2).
//   Device: Capacitor 8 core "SystemBars" plugin. Its config style "DEFAULT"
//           follows the OS night mode only — an in-app "Dark" choice on a
//           light-mode phone would leave dark icons on our dark header, so
//           store/themeStore.js calls setStyle() with the resolved theme.
//   Web:    no-op.
import { isNative } from "./platform.js";

export const isSupported = () => isNative();

/**
 * setStyle("light" | "dark") — the APP theme, i.e. the colour of the
 * content behind the bars. "dark" → light icons, "light" → dark icons.
 */
export async function setStyle(resolvedTheme) {
  if (!isNative()) return false;
  try {
    const { SystemBars, SystemBarsStyle } = await import("@capacitor/core");
    await SystemBars.setStyle({
      style:
        resolvedTheme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    });
    return true;
  } catch {
    return false;
  }
}
