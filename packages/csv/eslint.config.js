// Same rules as the web app (the packages/ui pattern), plus the layering
// rules for a framework-free package: no React, no native shell, no app or
// UI-kit imports. node --test runs src/csv.test.mjs, so the suite gets Node
// globals instead of the browser set.
import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import base from "../../frontend/eslint.config.js";

export default defineConfig([
  ...base,
  {
    files: ["**/*.test.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{js,mjs}"],
    rules: {
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
                "@abaco/csv is shared by the web app and the phone; native plugins belong in mobile/src/native.",
            },
            {
              group: ["react", "react-*", "@tanstack/*", "i18next"],
              message:
                "@abaco/csv is framework-free (node --test runs it); keep React and i18n in the apps.",
            },
            {
              group: [
                "**/frontend/src/*",
                "**/mobile/src/*",
                "@abaco/ui",
                "@abaco/ui/*",
              ],
              message:
                "The CSV helpers cannot import from an app or the UI kit.",
            },
          ],
        },
      ],
    },
  },
]);
