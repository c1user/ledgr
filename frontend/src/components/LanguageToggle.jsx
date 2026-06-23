import { useState } from "react";
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
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const current = i18n.language === "es" ? "es" : "en";
  const [saveFailed, setSaveFailed] = useState(false);

  const changeLanguage = async (lang) => {
    if (lang === current) return;
    const previous = current;
    setSaveFailed(false);

    // Optimistic UI switch
    setAppLanguage(lang);
    useAuthStore.setState({ user: { ...user, language: lang } });

    try {
      await api.patch("/auth/language", { language: lang });
    } catch (err) {
      // Revert on failure — and surface it, so the snap-back isn't a mystery.
      console.error("Failed to save language preference:", err);
      setAppLanguage(previous);
      useAuthStore.setState({ user: { ...user, language: previous } });
      setSaveFailed(true);
      setTimeout(() => setSaveFailed(false), 4000);
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
    <div style={{ position: "relative", display: "inline-flex" }}>
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

      {saveFailed && (
        <div
          role="alert"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            whiteSpace: "nowrap",
            background: "var(--danger-bg)",
            color: "var(--danger)",
            border: "0.5px solid var(--danger)",
            borderRadius: 6,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 500,
            zIndex: 200,
          }}
        >
          <i
            className="ti ti-alert-circle"
            style={{ marginRight: 5 }}
            aria-hidden="true"
          />
          {t("nav.languageSaveFailed")}
        </div>
      )}
    </div>
  );
}
