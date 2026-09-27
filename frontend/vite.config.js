import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { BRAND, HEX } from "@abaco/tokens/brand.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Phase 2 — installable PWA. The same build is later wrapped by Tauri
    // (desktop). Mobile is a SEPARATE companion app (mobile/, "Abaco Scan":
    // receipt scan + AI) that shares packages/* (tokens, ui, locales) and
    // the hosted API — it does not wrap this build. See ROADMAP-V6.md.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: BRAND.name,
        short_name: BRAND.name,
        description:
          "Accounting for small businesses — invoicing, payroll, taxes and a real double-entry ledger.",
        theme_color: HEX.brand,
        background_color: HEX.canvasLight,
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell only. API calls are never intercepted —
        // financial data must always come from the network.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
});
