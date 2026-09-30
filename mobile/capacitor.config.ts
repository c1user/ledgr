// Capacitor configuration for the AbacoPR Lite native shells (ROADMAP-V6 3.1).
// Read by the Capacitor CLI (`npx cap sync`). Keep the splash colour equal to
// HEX.canvasLight in @abaco/tokens/brand.js (the in-app boot splash canvas).
//
// DEV SHELL (ROADMAP-V6 2.14b/c): `CAP_ENV=dev npx cap sync` produces a build
// that may talk to the developer's PC over plain http (emulator: 10.0.2.2,
// phone: the PC's LAN address). The WebView page lives on https://localhost,
// so an http API call is mixed content — both switches below are required
// and both are OFF in release builds (they also change AndroidManifest /
// network-security-config on the next sync).
import type { CapacitorConfig } from "@capacitor/cli";

const dev = process.env.CAP_ENV === "dev";

const config: CapacitorConfig = {
  appId: "com.abacopr.lite",
  appName: "AbacoPR Lite",
  webDir: "dist",
  server: {
    // Android serves the bundle from https://localhost so the WebView origin
    // is a secure context (camera, clipboard, crypto). The backend's CORS list
    // includes this origin (ROADMAP-V6 1.8). iOS keeps capacitor://localhost.
    androidScheme: "https",
    hostname: "localhost",
    cleartext: dev,
  },
  ios: {
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: dev,
    appendUserAgent: "AbacoPRLite",
  },
  plugins: {
    SplashScreen: {
      // App.jsx hides the launch splash as soon as the auth store has
      // hydrated (native/splash.js). launchShowDuration is only the BACKSTOP:
      // if the bundle never runs, the plugin hides it after 15 s instead of
      // leaving a blank screen forever. On Android 12+ the launch splash is
      // the SYSTEM one — its colours and icon come from
      // android/app/src/main/res/values/styles.xml (windowSplashScreen*),
      // not from backgroundColor, which only styles the plugin-drawn view
      // (iOS, and show() at runtime).
      launchAutoHide: true,
      launchShowDuration: 15000,
      backgroundColor: "#f7f6fa",
      showSpinner: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    SystemBars: {
      style: "DEFAULT",
      insetsHandling: "css",
    },
    // PrivacyScreen has NO config keys: the plugin is off until JS calls
    // enable(), which App.jsx does at boot through native/privacy.js (skipped
    // in the dev shell, i.e. bundles built with VITE_DEV_SHELL=1, so device
    // screenshots keep working while building).
  },
};

export default config;
