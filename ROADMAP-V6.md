# ROADMAP V6 — Mobile companion app "AbacoPR Lite"

Owner decision (2026-09-21): **web + desktop = the full Abaco app** (the
`frontend/` build; Tauri wraps that same build per V4 Phase 4). **Mobile is
NOT a wrap of the full app.** It is a separate, smaller companion for two
jobs — scanning receipts into the books and talking to the AI assistant —
that shares the **same colors, fonts, and database** as the website and
desktop app. Same hosted API, same accounts, same PostgreSQL and S3: a
receipt scanned on the phone is an ordinary `receipts` row that appears in
the web Receipts page immediately. No new tables, no migrations.

This roadmap replaces V4 Phase 5 ("Capacitor wrap"). Phases 0–2 need only
the local backend and can start now; Phase 3 (device testing, beta
channels, stores) needs the hosted API (V4 1.3). The whole track runs in
parallel with V4 Phase 4.

**The one architectural fact that shapes everything:** brand identity is
shared by *construction*, not by copying. Both apps import the same CSS
token file, the same Tailwind preset, the same self-hosted font files, and
the same UI-kit primitives from `packages/*`, and both render in a WebKit /
Chromium engine — so a Card on the phone is the Card from the website. The
phone is free above that layer: its own bottom tab bar, its own
phone-first screens, its own native features.

**Decisions locked with the owner (2026-09-25):**
- Stack: **Capacitor 8** around a separate phone-first **React 19 + Vite 8 +
  Tailwind 3.4** app in `mobile/` (chosen over Expo/React Native — which can
  only match colors and fonts by value, not by pixel, and needs a second
  hand-written UI kit — and over a "mobile build mode" of the full app,
  which couples the phone to every web change and reads as a shrunken
  website in App Review).
- **Node 22 LTS** on the dev machine (Capacitor 8 CLI requires ≥ 22).
- **Root npm workspace** (`packages/*`, `frontend`, `mobile`; `backend/`
  stays standalone).
- **Both apps self-host fonts and icons** (fontsource + the Tabler npm
  package); the website drops Google Fonts and the jsdelivr `@latest` link.
- **Final name "AbacoPR Lite", `appId com.abacopr.lite`** (owner decision
  2026-09-27; baked into the Apple identifiers and store records) — distinct
  from the installable PWA "Abaco" so both can live on one Android home screen.
- Shared UI kit stays **primitives only** (Button, Card, Badge, Input,
  Select, Textarea, Field, Modal, Tabs, TabNav, PageHeader, EmptyState,
  Toggle, FilterSheet). Navigation and screens are the phone's own.
- **Sign-in only.** No registration, no pricing, no purchase buttons or
  links anywhere in the app on either platform (Apple 3.1.3(f) companion
  posture; V4 2.6). Plan upsells are informational text.

---

## What ships in v1 (owner's feature picks, 2026-09-25)

**Core**
- Sign in with email + password + the authenticator (TOTP / backup code)
  step; JWT held in the iOS Keychain / Android KeyStore, never in browser
  storage.
- **Scan** (home tab) → **Review & book** → **Receipts** list/detail →
  **Assistant** chat → **Settings**.

**Smartphone-native features**
- **Document scanner camera** — live edge detection, auto-capture when a
  receipt is framed, perspective crop, deskew, contrast; "scan a stack"
  batch mode that uploads each page in sequence. Cleaner images raise the
  AI's extraction confidence.
- **"Share to AbacoPR Lite"** — the app appears in the iOS/Android share sheet
  and accepts photos, screenshots, and PDFs from Mail, Photos, WhatsApp,
  Files into the review queue.
- **Offline capture queue** — snap with no signal; uploads when back online;
  badge on the Scan tab; never retries 4xx.
- **Face ID / fingerprint lock** after N minutes in the background (Settings
  toggle).
- **Deadline and review reminders as local notifications** — IVU due dates
  and payroll filings from the existing compliance feed, plus "N receipts
  waiting for review", scheduled on-device. No push server.
- **Haptics** on capture / booked / warning; **app shortcuts** (long-press
  icon → "Scan receipt", "Ask the assistant"); **swipe actions** on receipt
  rows (book / delete).
- **Voice input for the assistant** (EN + ES), optional spoken answers.
- Phone polish: system dark mode, one-time-code autofill on 2FA, decimal
  keypad for amounts, pull-to-refresh, pinch-zoom receipt viewer, status
  bar matching the theme, privacy screen in the app switcher.

**v1.1 (approved for planning):** AI extraction for PDF receipts (backend
only — Claude accepts PDF input; `receipts.js` currently skips AI for
PDFs), so shared PDFs get merchant/date/total too.

**Deliberately deferred (owner declined for now):** smart booking defaults
from past merchants, on-device OCR preview, an AI category-suggestion
endpoint, push notifications + weekly AI spending digest, home-screen
widgets / Siri, deep links, location memory.

**Explicitly OUT of the phone app (stay on web/desktop):** registration,
email verification, password-reset UI, team invites, tour; transactions
list/editor, dashboard, reports, accounts/COA/rules editing, invoices
(incl. the AI invoice draft), payroll, inventory, projects; Plans / pricing
/ Stripe / Apple IAP (no purchase surface at all); ledger-funded bookings,
withholding, FX, vendor/project tagging; camera capture of PDFs (PDFs
arrive only via the share sheet); iPad/tablet layouts.

**Permissions this set adds:** camera, microphone + speech recognition,
Face ID / biometrics, notifications. Ask at the moment of use, each
switchable in Settings; usage strings in EN and ES.

---

## Architecture (summary — details in the plan spec)

```
ledgr/
  package.json          NEW  { "private": true, "workspaces": ["packages/*", "frontend", "mobile"] }
  package-lock.json     NEW  single lockfile (frontend/package-lock.json goes away)
  backend/              UNCHANGED shape — not a workspace member (own npm ci, own node --test)
  frontend/             full app: web + Tauri desktop; imports @abaco/tokens, @abaco/ui, @abaco/locales
  mobile/               NEW  "AbacoPR Lite": Vite 8 + React 19 + Tailwind 3.4 + Capacitor 8
  packages/
    tokens/   @abaco/tokens   tokens.css (verbatim :root + [data-theme="dark"]), fonts.css, tailwind.preset.js, brand.js, drift test
    ui/       @abaco/ui       the 14 primitives + cx + BrandMark + SplitEditor + feedback (toast/confirm)
    locales/  @abaco/locales  en.json, es.json, coa.js (coaToCategories/resolveCatName), parity test
    flows/    @abaco/flows    OPTIONAL: pure hooks (useReceiptBooking, useLogin, useAiChat) so web + phone run one API sequence
```

- **Colors and fonts:** `tokens.css` is the `:root` / `[data-theme="dark"]`
  block moved verbatim out of `frontend/src/index.css`; the Tailwind theme
  becomes a preset whose `addBase` plugin emits the body/h1/focus/scrollbar
  rules (reading `theme("fontFamily.*")`, so a family rename can never go
  stale). Fonts: `@fontsource-variable/inter` ("Inter Variable"),
  `@fontsource-variable/fraunces` `opsz.css` ("Fraunces Variable", the same
  opsz+wght axes as today's Google request), `@fontsource/dm-mono` 400/500;
  icons from `@tabler/icons-webfont` (already a dependency, unused today).
  Only visible web change: the fontsource family names; glyphs are the same
  variable fonts. Tailwind stays on 3.4 in both apps (the preset is
  v3-shaped; move both to v4 at once).
- **UI kit:** moved to `packages/ui` verbatim with re-export shims at every
  old `frontend/src` path (zero import churn across the ~50 kit import
  statements in 48 files). Two
  additions used by both apps: `Modal` bottom-sheet safe-area padding +
  `size="full"`, and `Button size="lg"` (44 px thumb target). Rule enforced
  by ESLint `no-restricted-imports`: `@abaco/ui` (and `@abaco/flows`) never
  import `@capacitor/*`; `mobile/` never imports `frontend/src/pages/*`.
- **Database / API:** the phone calls the same Express API over HTTPS with
  the same 7-day HS256 Bearer JWT. Boot: token from secure storage → decode
  `exp` (skip the doomed `/auth/me` when expired) → `GET /api/auth/me` →
  `GET /api/business/entitlements`. Login → `POST /api/auth/login` →
  `{mfaRequired, mfaToken}` → `POST /api/auth/2fa/verify-login`. Any 401 on a
  request that carried the token wipes the Keychain entry and returns to
  sign-in with the "session expired" banner. No refresh endpoint on purpose
  (a sliding refresh would make a stolen token indefinitely renewable;
  `token_version` bumps on the web produce the 401 path).
- **Native shell:** `capacitor.config.ts` with `androidScheme: "https"`
  (Android WebView origin = `https://localhost`; iOS =
  `capacitor://localhost`), `SystemBars` (Capacitor 8 core) for status-bar
  style and `--safe-area-inset-*` CSS vars — never `StatusBar.setBackgroundColor`
  (gone on Android 15+), `@capacitor/privacy-screen` 2.x (official),
  portrait lock (the kit's `sm:` 640 px breakpoint would otherwise flip
  Modal to a centered dialog in landscape), Android back button → router
  history, keyboard `resize: "native"`.
- **Capture pipeline:** JPEG at quality 85 / ~2000 px long edge (300–900 KB,
  under the 10 MB Multer cap, sidesteps iPhone HEIC), `formData.append(
  "receipt", blob, "receipt-<ts>.jpg")` to the existing
  `POST /api/receipts/upload`; an `idempotencyKey` **form field** (not a
  header — the CORS `allowedHeaders` list would block it), ignored by the
  server until v1.1. Progress → "Reading the receipt…" (5–15 s) → Review.
- **CSP:** Capacitor injects an inline bridge script into `index.html`, so
  `script-src 'self'` alone breaks the app; ship a hash-based CSP computed
  after `cap sync`, with a per-platform `'unsafe-inline'` fallback if a
  runtime-injected script is not hash-matchable.
- **Plugin candidates (verify names/versions against Capacitor 8 at build
  time):** `@capacitor/camera` 8.x (`takePhoto` / `chooseFromGallery`;
  `getPhoto`/`pickImages` are deprecated) as the fallback capture path; a
  document-scanner plugin (iOS VisionKit / Android ML Kit, e.g.
  `capacitor-document-scanner`); an in-house `ShareIntake` plugin for the share-sheet target (send-intent was tried and dropped, see 2.6);
  `@aparajita/capacitor-secure-storage` 8.x; `@aparajita/capacitor-biometric-auth`;
  `@capacitor/local-notifications`; `@capacitor/haptics`;
  `@capawesome/capacitor-app-shortcuts`; `@capacitor-community/speech-recognition`
  (+ `@capacitor-community/text-to-speech`); `@capacitor/filesystem`,
  `@capacitor/network`, `@capacitor/app`, `@capacitor/keyboard`,
  `@capacitor/splash-screen`, `@capacitor/browser`, `@capacitor/assets`.

---

## Phase 0 — Decisions & prerequisites  *(no app code)*

- [ ] **0.1 Identity** — name/id DECIDED 2026-09-27: "AbacoPR Lite" /
      `com.abacopr.lite` (applied in brand.js, capacitor.config.ts, locales,
      docs). Still to do: icon variant (orange viewfinder corner on the abacus
      mark) and the name-availability check in both stores (V4 0.11).
- [ ] **0.2 Policy lock-in** — V4 2.6 = sign-in only; no purchase CTAs,
      links, or prices anywhere in the app; a production reviewer account
      on Premium (2FA off, a few receipts, rotating password) reconciled
      with V4 3.3.
- [x] **0.3 Node 22 LTS** — DONE 2026-09-27: Node 22.23.2 installed with
      winget (in-place upgrade from 20.19.4; npm stays 11.5.2). Verified on 22:
      backend 239 tests, frontend lint/build/tests, mobile lint/162 tests/prod
      build, package tests; `npx @capacitor/cli@8 --version` → 8.5.2. One
      change needed: Node 22's test runner no longer accepts a directory, so
      `backend/package.json` test script is now `node --test "tests/*.test.mjs"`.
- [x] **0.4 Android toolchain** — DONE 2026-09-27: Android Studio installed
      by the owner (SDK at %LOCALAPPDATA%AndroidSdk: platform 37, build-tools
      36, platform-tools, emulator; license accepted). Its bundled runtime is
      JDK 25, which Gradle 8.14 (Capacitor 8 template) cannot run on, so
      Microsoft OpenJDK 21 was installed via winget; `ANDROID_HOME` and
      `JAVA_HOME` set as user env vars. Capacitor CLI 8.5.2 + @capacitor/android
      + @capacitor/ios + typescript added to mobile/; `npx cap add android`
      generated mobile/android (18 plugins). Still needed: an emulator (Google
      APIs image) or a USB phone.
- [ ] **0.5 iOS build lane — DECIDED 2026-09-25: paid Apple Developer
      Program + TestFlight** (chosen over free-Apple-ID sideloading, which
      expires weekly and cannot run the share extension or reach testers).
      Apple Developer Program: PURCHASED (owner, 2026-09-26). Next: App Store Connect
      app record for `com.abacopr.lite` + API key, TestFlight internal
      group with the owner's iPhone, a Codemagic or GitHub Actions macOS
      job skeleton (no Mac on hand; iOS binaries are compiled only in CI).
- [x] **0.6 Docs** — this file; V4 intro, 0.11, 2.6, Phase 5 → pointer,
      footer; PENDIENTES line 6, §2.6, §3.3, §4.4, ruta crítica 6;
      `frontend/vite.config.js` comment; backend CORS comments (`app.js`,
      `.env.example`, `tests/cors.http.test.mjs`); memory note. (2026-09-25)

## Phase 1 — Shared foundation  *(touches the web app; one PR per item; also makes the Tauri build offline-safe)*

- [x] **1.1 Root workspace** (2026-09-25) — root `package.json` + single lockfile;
      hosting build command becomes `npm ci && npm run build -w frontend`
      from the repo root; `.githooks/pre-commit` gains the package tests and
      the mobile lint.
- [x] **1.2 `@abaco/tokens`** (2026-09-25) — `tokens.css`, `fonts.css`, `tailwind.preset.js`
      (theme + `addBase` plugin for body/h1/focus/scrollbar, plus the
      `fadeIn` keyframes / `.fade-in` and the `.scrollbar-none` utility that
      `Modal`, `Tabs`, `TabNav` and `FeedbackHost` depend on — they must
      ship with the kit, not stay in the web-only CSS), `brand.js` (absorbs
      `frontend/src/config/brand.js` + its test: name, appId, HEX for splash
      / status bar / manifest; re-export shim left at the old path), a drift
      test asserting every HEX exists in `tokens.css`, README noting the
      Tailwind 3.4 pin.
- [x] **1.3 Web adopts the tokens** (2026-09-25; verified light/dark in Chrome: Inter Variable 14px/1.6, Fraunces titles, hairline borders, icons, zero third-party requests) — `frontend/src/index.css` shrinks to the
      imports + `@tailwind` + `.tour-highlight` (with its `tourPulse`
      keyframes); `tailwind.config.js` uses the
      preset and adds `../packages/ui/src` to `content`; remove the Google
      Fonts `@import` and the CDN Tabler `<link>` in `frontend/index.html`;
      manifest `theme_color`/`background_color` read `brand.js`; delete the
      unreferenced `frontend/src/App.css`; light/dark visual pass (wordmark,
      h1 Fraunces, mono amounts, hairline borders, line-height 1.6).
- [x] **1.4 `@abaco/ui`** (2026-09-25) — move the kit + `cx.js` + `BrandMark.jsx` +
      `SplitEditor.jsx` + feedback store/host; re-export shims at all old
      paths; add `Modal` safe-area padding + `size="full"`, `Button size="lg"`.
- [x] **1.5 `@abaco/locales`** (2026-09-25; the `login.*` / `mobile.*` key groups are added in Phase 2 alongside the screens that use them, so the copy is written once) — move `en.json`/`es.json`, `coaCategories.js`
      → `coa.js`, the parity test; update the path in
      `backend/src/services/reportPdf.js`; add `login.*` and `mobile.*` key
      groups in both languages.
- [ ] **1.6 `@abaco/flows` (optional, recommended — deferred; decide when Phase 2.6 starts)** — `useReceiptBooking`
      (+ `isHalfLinked` for the "Finish linking" self-repair), `useLogin`,
      `useAiChat`, `apiErrors`; re-point `pages/Receipts.jsx` first with zero
      visual change and a manual regression pass; `Login.jsx` / `AiChat.jsx`
      may follow later.
- [x] **1.7 ESLint layering** (2026-09-25: frontend + packages/ui forbid `@capacitor/*`; the mobile-side rules land with 2.1) — `@abaco/ui`, `@abaco/flows`, `frontend/**`
      may not import `@capacitor/*`; `mobile/src/**` outside `native/` may
      not import `@capacitor/*`; `mobile` may not import `frontend/src/pages/*`.
- [x] **1.8 Backend contract** (2026-09-26; 237 backend tests green, +4 HTTP suites. Also fixed on review: DELETE /transactions/:id now locks the header first and releases its receipt; the 409 guards and DELETE /receipts/:id require a live reference so legacy dangling-'linked' rows self-heal; the receipts list join is a single tenant-scoped pass. Residual, pre-existing: two concurrent PUT /link calls that swap receipts between transactions can still deadlock — Postgres aborts one; reorder link's locks (transaction first) if it ever shows up.) *(all additive, no migrations, each with an
      HTTP-harness test)* — commit the multi-origin CORS list with the
      Android origin `https://localhost`; mount the existing (unused)
      `uploadLimiter` on `POST /receipts/upload`; Multer errors → 413
      `FILE_TOO_LARGE` / 415 `UNSUPPORTED_TYPE` instead of the generic 500;
      `PUT /receipts/:id/review` never demotes a `linked` receipt; atomic
      booking — `POST /transactions` with `receiptId` verifies ownership,
      rejects an already-linked receipt (409 `RECEIPT_LINKED`), and flips
      `receipts.status='linked'` inside the same DB transaction (the web's
      follow-up `PUT /link` becomes idempotent); `GET /business/entitlements`
      adds `usage.aiReceiptsThisMonth`; `GET /receipts` gains
      `limit/offset/include=url` and de-duplicates multi-linked rows;
      public `GET /api/meta { apiVersion, minMobileBuild }`; `authLimiter`
      skips GET (today only failed auth requests count, but a 401 on
      `GET /auth/me` after a `token_version` bump would burn one of the 10
      login attempts per 15 min per IP); `TRUST_PROXY=1` (already supported
      in `app.js` and documented in `.env.example`) must be set on the
      production host.
- [ ] **1.9 Icons** (do at the start of 3.1, when `@capacitor/assets` consumes them) — `frontend/scripts/generate-icons.mjs --mobile` writes
      the 1024 icon set + 2732 splash (light/dark) from the same BrandMark
      geometry; a test asserts its colors equal `brand.js`.

## Phase 2 — Mobile app core  *(everything here is verifiable in Chrome device mode on Windows against the local backend)*

- [x] **2.1 Scaffold** (2026-09-27) — `mobile/` wired to the packages; `index.html` with
      `viewport-fit=cover` + CSP meta; `VITE_API_URL` required at build
      (absolute — a relative `/api` cannot work from a WebView origin);
      eslint/vitest; `capacitor.config.ts` committed.
- [x] **2.2 Auth plumbing** (2026-09-27) — `secureStore.js` (native Keychain/KeyStore;
      web fallback in dev only), in-memory `authStore`
      (`hydrate/signIn/expire/signOut`), `api.js` (Bearer header, 401-with-
      token → expire), `jwt.js` exp pre-check + resume watchdog (prompt
      re-login 24 h before the 7-day expiry), `/api/meta` gate + "Update
      required" screen.
- [x] **2.3 Login + 2FA screens** (2026-09-27) — 2FA step built from the web flow; not exercised in Chrome (the demo account has no TOTP); verify on device in 3.2/3.4 — device-locale language before sign-in,
      expired / too-many-attempts banners, forgot-password call ("the reset
      link opens on the web"), TOTP/backup-code step with one-time-code
      autofill; "Accounts are created at abacopr.com" as plain text.
- [x] **2.4 Shell** (2026-09-27) — 52 px header (wordmark classes from the web) + bottom
      `TabBar` (Scan · Receipts · Assistant · Settings) with safe-area
      insets; theme store light/dark/system syncing `data-theme` and the
      status-bar style; language toggle → `PATCH /auth/language`; offline
      banner; `100dvh` with `100vh` fallback.
- [x] **2.5 Capture + upload** (2026-09-27) — verified end to end in Chrome with a real 5.6 MB iPhone photo: resized in-app, uploaded, read by the AI, booked; document scanner = ML Kit on Android, plain camera on iOS (no Capacitor-8 VisionKit plugin; revisit in 3.1) — `native/camera.js` (document scanner, with
      `@capacitor/camera` and a browser file input as fallbacks), batch
      "scan a stack", upload with progress + `idempotencyKey` field, error
      mapping (403 `UPGRADE_REQUIRED` → text-only `UpsellNotice`; 413/415;
      429; network → outbox), Starter meter from entitlements `usage`.
- [x] **2.6 Share-sheet intake** (2026-09-27) — `native/shareIntake.js` + subscription on the Scan tab; the Shell switches to Scan when a share lands on another tab. Android side = in-house `ShareIntakePlugin.java` (MainActivity is the share target; files copied to cacheDir/shared, window event `abacoShareReceived`, `consume()`); the `send-intent` package was dropped 2026-09-27 — its receiving activity is a second BridgeActivity that finishes itself on pause, so uploads started from it died. iOS share extension implements the same contract in 3.4 — images and PDFs
      received from other apps enter the same upload pipeline (PDFs upload
      without AI until v1.1).
- [x] **2.7 Review & book** (2026-09-27) — atomic booking via the 201 receipt field verified against the API (full page, sticky CTA) — confidence bar,
      merchant / date / total, editable line items; account picker (active
      bank accounts only; last used preselected), expense/income, localized
      category sheet (`coaToCategories`, grouped, searchable, inactive
      filtered, "Suggested" row from `GET /api/rules` matched client-side),
      split editor seeded from line items, notes → book (toast + haptic +
      "Scan another"); save for later; link to an existing transaction
      (amount ±1 % / date ±7 d pre-filter over `GET /transactions?limit=100`);
      delete with confirm (disabled when linked); swipe actions on rows.
- [x] **2.8 Receipts list + detail** (2026-09-27) — GET /receipts/:id now also returns transaction_id/transaction_merchant (backend, tested); the transactions list endpoint returns { transactions, total, limit, offset } (consumers fixed) — status chips, pull-to-refresh,
      pagination, thumbnails (`include=url` + local captures), "Finish
      linking" self-repair on half-linked rows, detail with pinch-zoom image
      (`signed_url`, 1 h, refetched on open), linked-transaction summary,
      "Ask about this merchant" → Assistant pre-filled.
- [x] **2.9 Assistant** (2026-09-27) — real chat verified; backend now feeds live ledger balances and asks for plain text (no Markdown), which also fixes the web chat; speech plugin JS is Capacitor-7-era, native side verified in 3.1 — bubbles, typing indicator, suggested questions,
      keyboard-aware composer (≤ 1000 chars), **voice input** (speech
      recognition EN/ES; browser Web Speech API as the dev fallback) and
      optional spoken answers, history sheet (load / delete), new chat,
      Premium gate as text-only notice, long-press → "Report this answer" →
      existing `POST /api/support` (Google Play generative-AI policy).
- [x] **2.10 Settings** (2026-09-27) — biometric lock overlay layered above modals/toasts (z-400) after review — appearance, language, default account, biometric
      lock toggle + timeout, reminders toggle, "Open Abaco on the web"
      (dashboard, neutral wording), Terms/Privacy, "Delete account: from
      Settings › Business on the web" hint, sign out / sign out everywhere,
      version/build.
- [x] **2.11 Offline outbox** (2026-09-27) — after review: items stamped with the owner and cleared on explicit sign-out; 401 waits instead of dying; 429 still counts as a dead 4xx per spec (revisit: treat 429 as retryable) — captures persisted before upload
      (`Filesystem` on device; IndexedDB in the browser), retry on
      network/resume, never retry 4xx, cap ~50, badge on Scan.
- [x] **2.12 Local reminders** (2026-09-27; default OFF since 2026-09-29: the Settings toggle asks for the OS permission with its rationale, the scheduler only checks it) — planner + tests; native scheduling exercised in 3.2 (web is a no-op) — schedule on-device notifications from
      `GET /api/notifications` (compliance category) and pending-receipt
      counts, honoring the user's `notify_prefs`; reschedule on app resume.
- [x] **2.13 Tests** (2026-09-27) — (2026-09-29: shortcuts registered from the Shell + click routing; privacy screen enabled at boot via native/privacy.js — both were wrappers nothing called)  11 vitest files, 162 tests; EN/ES + light/dark verified in Chrome at 375×812 with the demo account; computed-style parity holds (Inter Variable 14px/1.6, Fraunces titles, --brand) — vitest smoke for `api.js` 401 handling,
      `authStore.hydrate`, outbox reducer, reminder scheduling, `apiErrors`
      mapping; EN/ES + light/dark pass in Chrome; computed-style parity
      check against the web dev server (`fontFamily`, `lineHeight`,
      `--brand`, border widths).
- [ ] **2.14 On-device loops (decided 2026-09-25)** — (a) is available now (see mobile/README.md); (b) and (c) open with Phase 3 — three ways to run the
      app on real phones while building, in the order they become available:
      (a) **iPhone browser over Wi‑Fi, from day one:** `npm run dev -w mobile
      -- --host`, open the PC's LAN address in Safari, "Add to Home Screen";
      `VITE_API_URL` = the PC's LAN backend, that origin added to
      `CORS_ORIGIN`. Covers screens, flows, fonts, colors, EN/ES, dark
      mode; native plugins fall back to web behavior.
      (b) **TestFlight dev shell (iPhone), once 0.5 exists:** one CI build
      whose `capacitor.config` `server.url` points at the PC's dev server
      (dev build only: cleartext / local-networking exception, never in
      release), installed through TestFlight internal testing (no Apple
      review). The native shell then loads the JavaScript live from the PC,
      so the scanner, Keychain, Face ID, haptics, reminders, shortcuts and
      share sheet run for real and every edit reloads instantly; rebuild
      through CI only when plugins, permissions or Capacitor config change.
      (c) **Android debug `.apk` + dev shell, once 0.4 exists:** built
      locally, installed by USB (`adb install`) or a link; same live-reload
      trick; no Google account or fee.
      Backend reachability until V4 1.3 (hosted API): the PC over the LAN,
      the iPhone's Personal Hotspot over USB (no router needed), or a free
      HTTPS tunnel (cloudflared) for testing on cellular away from the desk
      — the tunnel origin goes into `CORS_ORIGIN`.

## Phase 3 — Native shells, polish, stores

- [ ] **3.1 Native projects** — Capacitor 8.5.x; `npx cap add android &&
      npx cap add ios` (commit both); plugins per the list above;
      `@capacitor/assets` from the Phase 1.9 PNGs; `Info.plist`
      (`UIViewControllerBasedStatusBarAppearance=YES`, camera / photo /
      microphone / speech / Face ID usage strings EN+ES, portrait only,
      iPhone-only device family), `PrivacyInfo.xcprivacy`; the iOS share
      extension target; Android manifest portrait + permissions audit
      (camera, microphone; never `READ_MEDIA_IMAGES` — Photo Picker only).
      **Status 2026-09-27 (Android half done):** `npx cap add android/ios` done
      (both projects in the repo); Capacitor 8.5.x CLI on Node 22; JDK =
      Microsoft OpenJDK 21 (Android Studio's JBR 25 is too new for Gradle 8.14);
      `local.properties` uses forward slashes; the debug APK builds
      (`gradlew assembleDebug`; the root `build.gradle` lifts every library module
      to the project compileSdk because speech-recognition 7.x hard-codes 35).
      Manifest: portrait; MainActivity is the SEND / SEND_MULTIPLE share target
      (in-house `ShareIntakePlugin.java`, see 2.6); `SCHEDULE_EXACT_ALARM`
      removed (reminders are inexact). `Info.plist`: portrait + camera / photo /
      microphone / speech / Face ID strings (EN). **Pending:** icons + splash from
      1.9 via `@capacitor/assets`; iOS `es.lproj/InfoPlist.strings`,
      `PrivacyInfo.xcprivacy`, iPhone-only device family and the share extension
      (all at 3.4, where Xcode / CI can validate them); the CSP hash.
      **Status 2026-09-29:** the emulator's "gray screen" was the LAUNCH
      SPLASH: `launchAutoHide: false` keeps the Android 12 system splash up
      (and blocks every frame of the activity) until JS calls hide(), which
      nothing did. Now `native/splash.js` hides it as soon as the auth store
      settles (6 s JS watchdog; the plugin's `launchShowDuration: 15000` is the
      native backstop). Android 12 splash theme = canvas colour (values /
      values-night) + launcher icon until 1.9 lands; `ic_stat_abaco` small
      icon added; `src/release/AndroidManifest.xml` forces cleartext off and
      `app/build.gradle` refuses a release built from a dev-shell config;
      iOS `CapApp-SPM/Package.swift` regenerated (no send-intent).
- [ ] **3.2 Android on device** — emulator + USB phone: document scanner,
      share target, KeyStore token, biometric prompt, local notifications,
      app shortcuts, haptics, `SystemBars` insets, back button, keyboard,
      privacy screen, `https://localhost` CORS against the local backend
      (`CAP_ENV=dev` live reload), CSP verified.
      **Status 2026-09-27 (emulator Pixel_10a, Android 17):** verified — sign-in
      (light theme, Inter, brand colour, safe-area insets 54 / 24 px); token only
      in encrypted app-private storage; ML Kit document scanner launches; share
      from Google Photos → CaptureSheet → upload → AI read → Review (after
      replacing send-intent, whose activity is a second BridgeActivity); local
      reminders scheduled as inexact RTC_WAKEUP alarms (18:00 receipts, 09:00
      deadlines) with no "Alarms & reminders" prompt; `https://localhost` origin
      accepted by the local backend (dev shell → `http://10.0.2.2:5000`, cleartext
      only when `CAP_ENV=dev`). Capacitor pitfall fixed in `secureStorage.js` /
      `notifications.js`: never resolve a promise with a plugin proxy (`await`
      calls `.then()` natively). **Pending:** USB phone, biometric prompt, app
      shortcuts, haptics, keyboard, back button, privacy screen (on in release
      only), speech recognition, CSP; the reminder title says "deadline coming
      up" for an already-overdue ("vencida") obligation — wording follow-up.
      **Status 2026-09-29 (emulator, host-side screenshots):** the app
      renders — Scan / Receipts / Settings, light and dark; status-bar icons
      follow the APP theme (`native/systemBars.js` from themeStore — the core
      SystemBars config only tracks OS night mode); Android Back: tab root →
      minimise, open sheet → closes (Escape), nested screen → history.back
      (`lib/backButton.js`; the WebView's `canGoBack` is false for SPA
      entries and is ignored); app shortcuts registered ("Scan a receipt",
      "Assistant") and a shortcut tap routes; privacy screen really enabled
      at boot (`@capacitor/privacy-screen` ignores capacitor.config — off
      only in the dev shell, `VITE_DEV_SHELL=1`) — confirm FLAG_SECURE on the
      first release build; reminders default OFF and the scheduler turns the
      toggle off when the OS permission is missing; boot survives a KeyStore
      failure (→ Login). Found by an adversarial review workflow after the
      splash fix (3 lenses × 3 refuters). Still pending: USB phone, biometric
      prompt, haptics, keyboard, speech, CSP.
- [ ] **3.3 Android release** — upload keystore (custody like `JWT_SECRET`;
      losing it means a new listing), Play App Signing, AAB, internal
      testing → closed testing with 12 testers × 14 days (V4 0.7 clock —
      start with the first login-capable build).
- [ ] **3.4 iOS lane** — CI build + App Store Connect API-key signing →
      TestFlight; verify VisionKit scanner, share extension, Keychain,
      Face ID, safe areas, keyboard, notification permission copy on a
      physical iPhone; rent a Mac by the hour only if a signing/SPM error
      needs the Xcode GUI.
- [ ] **3.5 Native polish & privacy** — haptic patterns, keyboard/scroll on
      forms and chat, empty/error states, no token logging, native-only
      assertion for secure storage, cleartext / mixed content / WebView
      debugging off in release, EN/ES + dark-mode pass on both devices.
- [ ] **3.6 Compliance package** — Apple privacy labels + Google Data
      Safety (photos, financial data, email, microphone/voice, AI processing
      by Anthropic, S3 storage; no tracking, no ads, no analytics SDKs),
      review notes citing 3.1.3(f) + the reviewer account, screenshots
      EN+ES from devices, listing copy describing scan → book → assistant,
      privacy-policy and support URLs (V4 0.9 / 0.10; the policy must
      mention AI processing).
- [ ] **3.7 Submissions** — App Store + Play production; expect one
      rejection round each (4.2 minimum functionality, 3.1.1 purchase
      wording, privacy strings are the likely asks); answer with review
      notes, never with purchase links; add the app to V4 6.1 / 6.2.

## Phase 4 — Later (v1.1+, in likely order of value)

- [ ] AI extraction for PDF receipts (backend; Claude PDF input) — approved
      for planning.
- [ ] Server-side idempotency for uploads (honor the `idempotencyKey` field).
- [ ] `useLogin` / `useAiChat` adopted by the web pages (if `@abaco/flows`
      was built).
- [ ] Deferred by the owner, revisit after launch: smart booking defaults
      from past merchants · AI category suggestion endpoint · push
      notifications + weekly AI spending digest · on-device OCR preview ·
      deep links (Universal / App Links) · location memory · widgets / Siri
      (needs native Swift/Kotlin and a Mac) · iPad layout · native background
      upload · OTA JS updates · `GET /transactions?amount=&dateFrom=&dateTo=`
      for link-existing.

---

## Store posture (why the app is shaped this way)

- **Apple 3.1.1 / 3.1.3(f):** "Free apps acting as a stand-alone companion
  to a paid web based tool" may skip in-app purchase "provided there is no
  purchasing inside the app, or calls to action for purchase outside of the
  app." Hence: no prices, no plan comparison, no upgrade buttons, no links;
  upsell copy states availability only; the Settings web link opens the
  dashboard, never billing.
- **Apple 4.2 minimum functionality:** purpose-built phone UI (tabs, native
  scanner, share target, haptics, outbox, biometrics, secure storage) —
  every tab is useful standalone; the TestFlight build proves it.
- **Apple 5.1.1(v) account deletion:** applies to apps that offer account
  creation; this one does not. The Settings hint points to the existing web
  close-business flow. If a reviewer insists, an in-app screen over the
  existing `DELETE /api/business` is a one-day add.
- **Google Play:** camera + Photo Picker only; generative-AI policy →
  "Report this answer" + AI described in the listing; new-account closed
  test (12 testers × 14 days).

## Effort (solo developer, focused days; store clocks run in parallel)

| Phase | Days |
|---|---|
| 0 Decisions & prerequisites | 1–2 (+ Apple enrollment / Play account waits) |
| 1 Shared foundation + backend contract | 4–6 |
| 2 Mobile app core incl. scanner, share intake, voice, reminders, outbox | 14–18 |
| 3 Native shells, polish, compliance, beta, submissions | 7–10 (+ Play 14 days, Apple 1–3 days per round) |
| **Total** | **≈ 26–36 working days** · first Android / TestFlight builds ~week 4 · submissions ~week 7–8 · public ~week 9–11 |

**Verifiable on Windows without Xcode:** all of Phases 1–2 (Chrome device
mode at 375×812 with the demo account; backend `node --test`; workspace
tests; computed-style parity between the two dev servers); Android end to
end on the emulator / a USB phone; the iOS pipeline through CI logs and a
physical iPhone via TestFlight. **Not verifiable here:** the iOS Simulator
and Xcode-GUI-only diagnostics.

**Critical path:** 0.3/0.4 → 1.1–1.5 → 2.1–2.4 → first Android build
(3.1–3.2) → start the 14-day Play test (3.3) while the rest of Phase 2 and
3.4–3.6 finish; the iOS lane (0.5 / 3.4) can be proven with the 2.3 build.
V4 Phase 4 (Tauri) shares Phase 1's packages and proceeds in parallel.
