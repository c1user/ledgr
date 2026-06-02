import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
    },
  },
});

// Apply theme before React renders — reads directly from localStorage
const stored = localStorage.getItem("ledgr-theme");
const theme = stored ? JSON.parse(stored)?.state?.theme : "light";
document.documentElement.setAttribute("data-theme", theme || "light");

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
