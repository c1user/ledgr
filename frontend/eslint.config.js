import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    // Node-side build scripts (icon generator + its vitest suite).
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // ROADMAP-V6 1.7 layering: the web/desktop app never depends on a
      // native shell; Capacitor plugins belong in mobile/src/native only.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@capacitor/*",
                "@capacitor-community/*",
                "@capawesome/*",
              ],
              message:
                "The web app must not import native plugins (see ROADMAP-V6 1.7).",
            },
          ],
        },
      ],
    },
  },
]);
