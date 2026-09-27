// The theme lives in the shared preset (@abaco/tokens) so the phone and the
// web app are styled identically. Edit packages/tokens, not here.
import preset from "@abaco/tokens/tailwind.preset.js";

export default {
  presets: [preset],
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
    // Shared UI kit — its class names must be scanned too.
    "../packages/ui/src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
