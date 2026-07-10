import { useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { setAppLanguage } from "../i18n";
import cx from "../lib/cx";

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

  const btnClass = (lang) =>
    cx(
      "px-2.5 py-[3px] text-[11px] font-medium cursor-pointer transition-all",
      current === lang
        ? "bg-brand text-on-brand"
        : "bg-transparent text-secondary",
    );

  return (
    <div className="relative inline-flex">
      <div
        role="group"
        aria-label="Language"
        className="inline-flex rounded-md overflow-hidden border border-line"
      >
        <button
          onClick={() => changeLanguage("en")}
          className={btnClass("en")}
          aria-pressed={current === "en"}
        >
          EN
        </button>
        <button
          onClick={() => changeLanguage("es")}
          className={btnClass("es")}
          aria-pressed={current === "es"}
        >
          ES
        </button>
      </div>

      {saveFailed && (
        <div
          role="alert"
          className="absolute top-[calc(100%+6px)] right-0 whitespace-nowrap bg-danger-bg text-danger border border-danger rounded-md px-2.5 py-1 text-[11px] font-medium z-[200]"
        >
          <i className="ti ti-alert-circle mr-1" aria-hidden="true" />
          {t("nav.languageSaveFailed")}
        </div>
      )}
    </div>
  );
}
