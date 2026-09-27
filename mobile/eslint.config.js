// Same rules as the web app, plus the mobile layering rules from
// ROADMAP-V6 1.7:
//   - nothing in mobile/ imports from frontend/src (the phone owns its screens;
//     shared code lives in packages/*);
//   - native plugin packages are imported ONLY inside src/native/**, where
//     every wrapper checks Capacitor.isNativePlatform() and ships a web
//     fallback so the whole app runs in Chrome.
import globals from "globals";
import base from "../frontend/eslint.config.js";

const NATIVE_PACKAGES = [
  "@capacitor/*",
  "@capacitor-community/*",
  "@capawesome/*",
  "@aparajita/*",
  "@capacitor-mlkit/*",
];

const noFrontendImports = {
  group: ["**/frontend/src/*"],
  message:
    "mobile/ must not import from frontend/src — move shared code to packages/* (ROADMAP-V6 1.7).",
};

export default [
  ...base,
  {
    // Native projects: Gradle / Xcode output and the copied web bundle.
    ignores: ["android/**", "ios/**", "dist/**"],
  },
  {
    files: ["**/*.{js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noFrontendImports,
            {
              group: NATIVE_PACKAGES,
              message:
                "Native plugins are imported only inside mobile/src/native/** wrappers (with a web fallback).",
            },
          ],
        },
      ],
    },
  },
  {
    // The native wrappers are the one place plugins may be imported.
    files: ["src/native/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noFrontendImports] }],
    },
  },
  {
    // Node-side config files and the vitest suites (environment: "node").
    files: [
      "vite.config.js",
      "tailwind.config.js",
      "postcss.config.js",
      "src/**/*.test.{js,mjs}",
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
