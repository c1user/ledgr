import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { setAppLanguage } from "../i18n";

/**
 * EN | ES segmented toggle.
 * Optimistic: switches the UI immediately, persists to the backend
 * in the background, and reverts if the save fails.
 */
export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const current = i18n.language === "es" ? "es" : "en";

  const changeLanguage = async (lang) => {
    if (lang === current) return;
    const previous = current;

    // Optimistic UI switch
    setAppLanguage(lang);
    useAuthStore.setState({ user: { ...user, language: lang } });

    try {
      await api.patch("/auth/language", { language: lang });
    } catch (err) {
      // Revert on failure
      console.error("Failed to save language preference:", err);
      setAppLanguage(previous);
      useAuthStore.setState({ user: { ...user, language: previous } });
    }
  };

  const btnStyle = (lang) => ({
    padding: "3px 10px",
    fontSize: 11,
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    background: current === lang ? "var(--brand)" : "transparent",
    color: current === lang ? "#fff" : "var(--text-secondary)",
    transition: "all 0.15s",
  });

  return (
    <div
      role="group"
      aria-label="Language"
      style={{
        display: "inline-flex",
        borderRadius: 6,
        overflow: "hidden",
        border: "0.5px solid var(--border-color)",
      }}
    >
      <button
        onClick={() => changeLanguage("en")}
        style={btnStyle("en")}
        aria-pressed={current === "en"}
      >
        EN
      </button>
      <button
        onClick={() => changeLanguage("es")}
        style={btnStyle("es")}
        aria-pressed={current === "es"}
      >
        ES
      </button>
    </div>
  );
}
