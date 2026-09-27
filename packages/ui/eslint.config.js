// Same rules as the web app, plus the layering rule from ROADMAP-V6 1.7:
// the shared kit must never depend on a native shell.
import base from "../../frontend/eslint.config.js";

export default [
  ...base,
  {
    files: ["**/*.{js,jsx}"],
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
                "@abaco/ui is shared by the web app and the phone; native plugins belong in mobile/src/native.",
            },
            {
              group: ["**/frontend/src/*", "**/mobile/src/*"],
              message: "The shared kit cannot import from an app.",
            },
          ],
        },
      ],
    },
  },
];
