import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./i18n.js";
import { queryClient } from "./lib/queryClient.js";
import { THEME_STORAGE_KEY, resolveTheme } from "./store/themeStore.js";
import App from "./App.jsx";
import "./index.css";

// Apply the theme before React renders (no flash). Reads the persisted
// zustand shape directly: { state: { theme: "light" | "dark" | "system" } }.
try {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = stored ? JSON.parse(stored)?.state?.theme : "system";
  document.documentElement.setAttribute(
    "data-theme",
    resolveTheme(theme || "system"),
  );
} catch {
  document.documentElement.setAttribute("data-theme", "light");
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
