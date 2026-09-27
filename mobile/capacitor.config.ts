// Capacitor configuration for the Abaco Scan native shells (ROADMAP-V6 3.1).
// Read only by the Capacitor CLI (`npx cap sync`), which is NOT installed in
// Phase 2 (it needs Node 22). Keep the splash color equal to HEX.brand in
// @abaco/tokens/brand.js.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.abacopr.scan",
  appName: "Abaco Scan",
  webDir: "dist",
  server: {
    // Android serves the bundle from https://localhost so the WebView origin
    // is a secure context (camera, clipboard, crypto). The backend's CORS list
    // includes this origin (ROADMAP-V6 1.8). iOS keeps capacitor://localhost.
    androidScheme: "https",
    hostname: "localhost",
  },
  ios: {
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: false,
    appendUserAgent: "AbacoScan",
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
      enable: true,
    },
  },
};

export default config;
