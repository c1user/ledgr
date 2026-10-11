# AbacoPR Lite (`mobile/`)

The phone companion to Abaco (ROADMAP-V6). It does two jobs — **scanning
receipts into the books** and **talking to the AI assistant** — plus a
read-mostly **Accounts** tab (balances, per-account transactions, CSV
import/export; 2.15), and shares the website's colors, fonts, UI-kit
primitives and translations by construction (`@abaco/tokens`, `@abaco/ui`,
`@abaco/locales`, `@abaco/csv`). It talks to the **same hosted API** with the
same accounts: a receipt scanned here is an ordinary `receipts` row that
appears in the web Receipts page immediately.

- **Sign-in only.** No registration, no pricing, no plan names with prices,
  no purchase buttons or links anywhere. Plan upsells are informational
  text ("The assistant is part of the Premium plan. Plans are managed from
  your Abaco account on the web.").
- **Bilingual EN/ES** from day one — every string goes through `t()`; the
  keys live under `login.*` and `mobile.*` in `packages/locales/{en,es}.json`
  (the parity test in `packages/locales` enforces both files).
- **Phone-first:** bottom tab bar (Scan · Receipts · Accounts · Assistant ·
  Settings — five is the ceiling; new areas nest under an existing tab),
  44 px tap targets, 16 px inputs (no iOS zoom), pull-to-refresh, dark mode
  via `data-theme` on `<html>` (light | dark | system) exactly like the web.
- **Capacitor 8** wraps it in Phase 3. In Phase 2 only the plugin JS
  packages are installed; every native call has a web fallback, so the whole
  app runs in Chrome against the local backend.

## Dev loop (Chrome, day one)

```sh
# from the repo ROOT (single workspace lockfile — never npm install inside a package)
npm install
npm run dev -w mobile          # http://localhost:5174
```

- Vite listens on **port 5174** (`strictPort`) and proxies `/api` →
  `http://localhost:5000`, so `VITE_API_URL` stays unset in development and
  the app calls the relative `/api` (same origin, no CORS work).
- Start the backend separately (`cd backend && npm run dev`, port 5000).
- Open Chrome DevTools device mode at **375 × 812**; touch events drive the
  pull-to-refresh, swipe rows and pinch-zoom viewer.
- The Claude Code browser pane has a `mobile` entry in `.claude/launch.json`
  (`npm --prefix mobile run dev`, port 5174) next to `frontend` (5173) and
  `backend` (5000).

Other scripts (run from the root):

```sh
npm run lint -w mobile
npm test -w mobile                                # vitest, node environment
VITE_API_URL=https://abacopr.com/api npm run build -w mobile   # → mobile/dist
npm run preview -w mobile
```

### Dev shell (Android emulator / USB phone against the local backend)

The native shell that talks plain http to the PC — never a store build.
`VITE_DEV_SHELL=1` keeps the privacy screen off (screenshots work);
`CAP_ENV=dev` turns on cleartext + mixed content in the Capacitor config
(`app/build.gradle` refuses to assemble a release from such a config).
Emulator → `10.0.2.2`; a USB phone → the PC's LAN address, which must also be
in the backend's `CORS_ORIGIN`.

```sh
VITE_API_URL=http://10.0.2.2:5000/api VITE_DEV_SHELL=1 npm run build -w mobile
cd mobile && CAP_ENV=dev npx cap sync android
cd android && ./gradlew assembleDebug        # JDK 17–24 (JAVA_HOME), ANDROID_HOME set
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Before a store build run `npx cap sync android` again **without** `CAP_ENV`
and build the bundle without `VITE_DEV_SHELL`.

### iOS lane — Codemagic → TestFlight (ROADMAP-V6 3.4)

There is no Mac in the loop: `mobile/codemagic.yaml` builds the web bundle,
runs `cap sync ios`, archives `ios/App/App.xcodeproj` (scheme `App`, shared
in `xcshareddata`) with App Store Connect API-key signing and uploads to
TestFlight. Codemagic's project path for this app is `mobile`.

One-time setup (owner):

1. Apple: register the bundle ID `com.abacopr.lite` (Certificates,
   Identifiers & Profiles → Identifiers), create the App Store Connect app
   record "AbacoPR Lite" for it, and add yourself to an internal TestFlight
   group.
2. App Store Connect → Users and Access → Integrations → App Store Connect
   API: generate a key with the **App Manager** role; note the Issuer ID and
   Key ID and download the `.p8` once.
3. Codemagic → Team settings → Integrations → Developer Portal: add that key
   under the name **AbacoPR Lite ASC key** (the `integrations.app_store_connect`
   value in the YAML).
4. Codemagic → Team settings → Environment variables: group `abaco_ios` with
   `VITE_API_URL` = the https backend the phone will talk to. Until the API
   is hosted, run `cloudflared tunnel --url http://localhost:5000` on the PC
   and use the printed https URL + `/api` (add the same origin to the
   backend's `CORS_ORIGIN` only if you also open it in a browser; the
   WebView origin `capacitor://localhost` is already allowed).
5. Start the `ios-testflight` workflow on branch `ABACOM`; Apple processes
   the upload for 10–30 min, then it appears in the TestFlight app.

Build numbers: `CFBundleVersion` and `VITE_BUILD` both take Codemagic's
`BUILD_NUMBER`, so `GET /api/meta.minMobileBuild` can retire old builds.
Not in the first build: the iOS share extension (share-sheet intake is a
no-op on iOS until 3.4 lands it) and Spanish permission strings.

### Icons and splash (ROADMAP-V6 1.9)

One geometry (the BrandMark) drawn by `frontend/scripts/generate-icons.mjs`
with the colours of `@abaco/tokens/brand.js`; `mobile/resources/` holds the
sources `@capacitor/assets` consumes (committed, so the native projects can be
regenerated from scratch):

```sh
# 1. PWA icons + mobile/resources/ (the sources)
node frontend/scripts/generate-icons.mjs --mobile
# 2. every native asset from those sources
cd mobile && npx capacitor-assets generate --android --ios \
  --iconBackgroundColor "#5b3a9b" --iconBackgroundColorDark "#5b3a9b" \
  --splashBackgroundColor "#f7f6fa" --splashBackgroundColorDark "#110e18"
# 3. full-resolution adaptive launcher layers (the tool writes 48 dp ones)
node ../frontend/scripts/generate-icons.mjs --android-adaptive
```

Android: adaptive launcher icon (`mipmap-*/ic_launcher_{foreground,background}`;
the tool writes those two layers as 48 dp bitmaps that launchers stretch, so
step 3 overwrites them with 108 dp renders of the same 72 dp viewport — the
inset XML the tool writes is kept) + legacy PNGs + splash drawables for every
density, portrait/landscape and night; the Android 12+ system splash uses the
launcher icon on the canvas
colour from `values/colors.xml`. iOS: `AppIcon.appiconset` (1024) and the
universal light/dark `Splash.imageset`. The tool also re-serialises
`AndroidManifest.xml`; review that diff.

## On-device loops (ROADMAP-V6 2.14)

Three ways to run the app on a real phone, in the order they become
available:

1. **iPhone/Android browser over Wi-Fi — available now.**
   `npm run dev -w mobile -- --host`, then open `http://<PC-LAN-address>:5174`
   in Safari/Chrome and "Add to Home Screen". Because the page is no longer
   same-origin with the proxy, set `VITE_API_URL=http://<PC-LAN-address>:5000/api`
   (in `mobile/.env.local`) and add `http://<PC-LAN-address>:5174` to the
   backend's `CORS_ORIGIN`. Covers screens, flows, fonts, colors, EN/ES and
   dark mode; native plugins fall back to their web behavior (file input
   for the camera, Web Speech API for dictation, `localStorage` for the
   token with a console warning).
2. **TestFlight dev shell (iPhone) — Phase 3.** One CI build whose
   `capacitor.config` `server.url` points at the PC's dev server (dev build
   only, never in release), installed through TestFlight internal testing.
   The native shell loads the JavaScript live from the PC, so the scanner,
   Keychain, Face ID, haptics, reminders, shortcuts and share sheet run for
   real; rebuild only when plugins, permissions or Capacitor config change.
3. **Android debug `.apk` + dev shell — Phase 3.** Built locally, installed
   over USB (`adb install`) or a link; same live-reload trick; no Google
   account or fee.

Until the hosted API exists, the backend is reachable over the LAN, over
the phone's Personal Hotspot via USB, or through a free HTTPS tunnel
(cloudflared) whose origin goes into `CORS_ORIGIN`.

## Environment variables (`mobile/.env.example`)

| Variable           | Development                                                                                    | Production build                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`     | unset → relative `/api` through the Vite proxy                                                 | **required, absolute** (`https://abacopr.com/api`); `vite build` throws otherwise, because the WebView origin is `capacitor://localhost` / `https://localhost` |
| `VITE_BUILD`       | `0` / unset → the `/api/meta` version gate is skipped                                          | the native build number, compared against `GET /api/meta.minMobileBuild` to show the "Update required" screen                                                  |
| `VITE_APP_VERSION` | derived — `vite.config.js` defines it from `mobile/package.json` `version` (shown in Settings) | same                                                                                                                                                           |

A production build also injects a `Content-Security-Policy` `<meta>` whose
`connect-src` is derived from `VITE_API_URL`'s origin (dev builds get none,
so HMR and the proxy are unaffected).

## Layering rule (enforced by `mobile/eslint.config.js`)

```
mobile/src/**          may import @abaco/ui, @abaco/tokens, @abaco/locales, @abaco/csv (as packages)
mobile/src/native/**   the ONLY place that may import @capacitor/*, @capacitor-community/*,
                       @capawesome/*, @aparajita/*, @capacitor-mlkit/*
nothing in mobile/     may import from frontend/src/*
```

Every wrapper in `src/native/` exports `isSupported()`, checks
`Capacitor.isNativePlatform()` and ships a **web fallback**, loading the
plugin through a dynamic `import()` behind that check so the web build
never executes plugin code:

| Wrapper                      | Native                                                                                                                              | Web fallback                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `camera.js`                  | Android: ML Kit document scanner; iOS: `@capacitor/camera`                                                                          | `<input type="file">` + JPEG re-encode              |
| `secureStorage.js`           | Keychain / KeyStore                                                                                                                 | `localStorage` with a `console.warn`                |
| `network.js`                 | `@capacitor/network`                                                                                                                | `navigator.onLine` + online/offline events          |
| `speech.js`                  | speech-recognition (+ `speechSynthesis`)                                                                                            | Web Speech API                                      |
| `haptics.js`, `shortcuts.js` | the plugin                                                                                                                          | no-ops                                              |
| `privacy.js`                 | `@capacitor/privacy-screen` — enabled at boot by `App.jsx` (off in the dev shell)                                                   | no-op                                               |
| `splash.js`, `systemBars.js` | launch splash hide (`App.jsx`), status-bar style ← app theme (`themeStore`)                                                         | no-ops                                              |
| `shareIntake.js`             | Android: in-house `ShareIntakePlugin.java`; iOS: 3.4                                                                                | no-op                                               |
| `notifications.js`           | `@capacitor/local-notifications`                                                                                                    | no-op (`requestPermission()` → false)               |
| `biometrics.js`              | biometric-auth                                                                                                                      | `authenticate()` → true + `console.info`            |
| `outbox.js`                  | `@capacitor/filesystem` (`Data/outbox/<id>.jpg`)                                                                                    | IndexedDB                                           |
| `appLifecycle.js`            | `@capacitor/app` resume / back button                                                                                               | `visibilitychange`                                  |
| `browser.js`                 | `@capacitor/browser`                                                                                                                | `window.open`                                       |
| `share.js`                   | `@capacitor/share` + `@capacitor/filesystem` (`Cache/exports/<file>.csv`, deleted after the sheet closes; `purgeExports()` at boot) | hidden `<a download>`; clipboard as the last resort |

`@capacitor-community/speech-recognition` is published
for Capacitor 7 (its peer range admits 8); its native side is verified
in Phase 3 — see the `// Phase 3: plugin verification` note in the
wrapper. `@capacitor-community/text-to-speech` is not installed; spoken
answers use `window.speechSynthesis` until it is.

## Source map

```
src/
  App.jsx             routes (/login, /mfa, /update-required, and under the Shell:
                      /scan, /receipts, /receipts/:id, /receipts/:id/review,
                      /accounts, /accounts/:id, /accounts/:id/import, /assistant, /settings),
                      the biometric LockGate and the reminder scheduler
  components/         Shell (52 px header + <main> + TabBar — five tabs, Android Back roots
                      in lib/backButton.js ROOT_PATHS), RequireAuth, OfflineBanner,
                      UpsellNotice, Splash; per-screen folders auth/ scan/ review/ receipts/
                      accounts/ (AccountRow, BalanceSummary, AccountHero, accountFormat)
                      transactions/ (TransactionRow/List/Sheet/FilterSheet, ExportSheet,
                      useAccountTransactions, transactionFormat)
                      import/ (ColumnPickerSheet, ImportSummary) assistant/ settings/
  pages/              Login, Mfa, UpdateRequired, Scan, Receipts, ReceiptDetail, ReceiptReview,
                      Accounts, AccountDetail, ImportCsv, Assistant, Settings
  store/              authStore (session; not persisted), themeStore, prefsStore, outboxStore
  lib/                api (axios + 401 → session expired), apiErrors, jwt, secureStore,
                      queryClient, useEntitlements, useOnline, upload, outbox (pure reducer),
                      booking, lockGate, reminders, backButton, transactionsPaging
                      (page/filter helpers for GET /transactions), csvImport, csvExport
  native/             the plugin wrappers (see above)
  i18n.js             i18next + setAppLanguage (dayjs + <html lang>)
```

Conventions (enforced by lint, the locale parity test, or review):

- Tailwind class names are never built by string interpolation (literal
  class maps only), and colours only through the token classes
  (`surface/canvas/sunken/ink/secondary/muted/line/brand/income/expense`
  and their `-bg` variants); every tap target is ≥ 44 px
  (`min-h-[44px]`, list rows `min-h-[56px]`).
- Every i18n string is a **literal** key (never interpolated) under
  `mobile.*` in `packages/locales/{en,es}.json`; the parity test fails on a
  key present in one language only.
- `Button size="lg"` for primary CTAs; sticky CTAs inside `<main>` add no
  safe-area padding of their own because the TabBar below `<main>` already
  carries it.
- NUMERIC API columns arrive as **strings** and DATE/timestamp columns as
  **ISO timestamp strings** — convert at the edge with `Number(x)` and
  `dayjs(x).format("MMM D, YYYY")` for display (`"YYYY-MM-DD"` for the
  API); never `.slice(0, 10)` a timestamp. Balances render in the
  account's currency, transaction amounts in the business currency.
- `GET /api/transactions` returns `{ transactions, total, limit, offset }`;
  page it with `lib/transactionsPaging.js` and parse URL filter state only
  through `parseTxFilters()` (nothing user-editable reaches the API
  unchecked).
- Errors reach the UI only through `describeError(err, t, opts)` in
  `lib/apiErrors.js` (`opts.rateLimitedKey` picks the 429 copy; the
  Accounts screens pass `{ rateLimitedKey: "mobile.common.rateLimited" }`);
  network-only actions check `useOnline()` and disable their CTA offline.
- vitest runs in the **node** environment, so tests cover pure helpers and
  injected-dependency modules (`lib/*`, `native/*` with mocks), never
  rendered components.

## Phase 3 — what is still to do (ROADMAP-V6 3.x)

- Install **Node 22** and the Capacitor CLI (`@capacitor/cli` 8.5.x); run
  `npx cap add android && npx cap add ios` and commit both native projects.
- Generate the icon set and splash screens (`frontend/scripts/generate-icons.mjs --mobile`,
  Phase 1.9) and feed them to `@capacitor/assets`.
- Native plugin configuration: `Info.plist` usage strings (camera, photos,
  microphone, speech, Face ID — EN + ES), portrait lock, iPhone-only,
  `PrivacyInfo.xcprivacy`, the iOS share extension target; Android manifest
  permissions audit (camera, microphone; Photo Picker only), `SystemBars`
  insets, back button → router history, keyboard `resize: "native"`,
  `local-notifications` small icon, the `abaco-mobile-theme` → status-bar
  style sync noted in `store/themeStore.js`.
- Verify the Capacitor-7 plugin (speech recognition) on a
  device or replace it; decide on an iOS VisionKit scanner plugin (today
  iOS uses the plain camera).
- **CSP:** replace `script-src 'unsafe-inline'` with the sha256 hash of the
  bridge script Capacitor injects into `index.html` (computed after `cap sync`).
- Set `VITE_BUILD` in release builds so the `/api/meta` version gate is live.
- Then 3.2–3.7: Android on device, Android release + Play closed testing,
  the iOS CI lane + TestFlight, native polish, the compliance package and
  the store submissions.
