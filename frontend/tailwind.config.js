// The theme (semantic colors → CSS custom properties, hairline borders,
// fonts, base rules) lives in the shared preset so the web app and the
// mobile companion are styled identically. Edit packages/tokens, not here.
import preset from "@abaco/tokens/tailwind.preset.js";

export default {
  presets: [preset],
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
    // Shared UI kit (ROADMAP-V6 Phase 1.4) — its class names must be scanned too.
    "../packages/ui/src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
