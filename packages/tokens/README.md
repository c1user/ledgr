# @abaco/tokens

The single source of truth for Abaco's look, shared by the web/desktop app
(`frontend/`) and the mobile companion (`mobile/`, ROADMAP-V6).

| File                 | What                                                                                                                  | Consumed by                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `tokens.css`         | the `:root` (light) and `[data-theme="dark"]` color/spacing custom properties                                         | both apps' `index.css` (`@import "@abaco/tokens/tokens.css"`) |
| `fonts.css`          | self-hosted Inter Variable, Fraunces Variable (opsz), DM Mono 400/500, Tabler icon webfont                            | both apps' `index.css`                                        |
| `tailwind.preset.js` | the semantic Tailwind theme + a plugin with the base rules (body, h1, focus ring, scrollbar, fade-in, scrollbar-none) | both apps' `tailwind.config.js` via `presets: [preset]`       |
| `brand.js`           | `BRAND` (names, app id) and `HEX` literals for manifests / splash / status bar / icons                                | PWA manifest, native config, icon generator                   |
| `tokens.test.mjs`    | drift guard: HEX ↔ tokens.css, light ↔ dark variable parity                                                           | `npm test` (node:test, no deps)                               |

Rules:

- Change a color in `tokens.css` only. Never copy hex values into components.
- Font family names are the fontsource ones (`"Inter Variable"`,
  `"Fraunces Variable"`, `"DM Mono"`); the preset references them and the
  base plugin reads them from `theme()`, so a rename cannot go stale.
- This is a **Tailwind v3** preset. Keep both apps on Tailwind 3.4; migrate
  to v4 together.
- `<meta name="theme-color">` in each app's `index.html` is a literal — keep
  it equal to `HEX.brand`.
