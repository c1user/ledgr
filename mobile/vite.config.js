import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

// Settings shows "Version x.y.z · Build n": the version comes from this
// package's own version field (VITE_BUILD is the native build number).
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

// Production Content-Security-Policy, injected as a <meta> ONLY into
// production builds so the dev server (HMR, proxy) is unaffected.
// Phase 3.1 replaces script-src 'unsafe-inline' with the sha256 hash of
// Capacitor's injected native bridge script.
function csp(apiOrigin) {
  return [
    "default-src 'self'",
    `connect-src 'self' ${apiOrigin} https://*.amazonaws.com`,
    "img-src 'self' data: blob: https://*.amazonaws.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

function cspPlugin(apiOrigin) {
  return {
    name: "abaco-mobile-csp",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: csp(apiOrigin),
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "VITE_");
  const apiUrl = env.VITE_API_URL || process.env.VITE_API_URL || "";

  if (mode === "production" && !apiUrl) {
    throw new Error(
      "[mobile] VITE_API_URL is required for a production build and must be an " +
        "absolute URL (e.g. https://abacopr.com/api). Inside the native WebView " +
        "the page origin is capacitor://localhost, so a relative /api cannot " +
        "reach the server. See mobile/.env.example.",
    );
  }
  let apiOrigin = "";
  if (mode === "production") {
    try {
      apiOrigin = new URL(apiUrl).origin;
    } catch {
      throw new Error(
        `[mobile] VITE_API_URL must be an absolute URL, got "${apiUrl}".`,
      );
    }
  }

  return {
    plugins: [react(), mode === "production" && cspPlugin(apiOrigin)].filter(
      Boolean,
    ),
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
    },
    server: {
      port: 5174,
      strictPort: true,
      // Dev only: the app calls the relative "/api" and Vite forwards it to
      // the local backend — same origin, so no CORS configuration is needed.
      proxy: {
        "/api": {
          target: "http://localhost:5000",
          changeOrigin: false,
        },
      },
    },
    build: {
      target: "es2020",
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.{js,mjs}"],
    },
  };
});
