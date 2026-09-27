// Capacitor configuration for the AbacoPR Lite native shells (ROADMAP-V6 3.1).
// Read by the Capacitor CLI (`npx cap sync`). Keep the splash color equal to
// HEX.brand in @abaco/tokens/brand.js.
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
      // Hidden by the app once the auth store has hydrated (no white flash).
      launchAutoHide: false,
      backgroundColor: "#5b3a9b",
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
    PrivacyScreen: {
      // Blurs the app in the task switcher and blocks screenshots/recording
      // (FLAG_SECURE on Android). Off in the dev shell so device screenshots
      // and screen recordings work while building; always on in release.
      enable: !dev,
    },
  },
};

export default config;
