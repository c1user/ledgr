import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import dayjs from "dayjs";
import "dayjs/locale/es";
// Locale files are shared with the web app (ROADMAP-V6 Phase 1.5).
import en from "@abaco/locales/en.json";
import es from "@abaco/locales/es.json";

// Before sign-in the phone speaks the device's language; once the user loads,
// authStore applies user.language through setAppLanguage().
const deviceLanguage = () => {
  const lang =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "en";
  return lang.toLowerCase().startsWith("es") ? "es" : "en";
};

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: deviceLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});
dayjs.locale(i18n.language);

/**
 * Single entry point for changing the app language — identical to the web's.
 * Keeps i18next, dayjs and the <html lang> attribute in sync.
 */
export const setAppLanguage = (lang) => {
  const safe = lang === "es" ? "es" : "en";
  i18n.changeLanguage(safe);
  dayjs.locale(safe);
  if (typeof document !== "undefined") document.documentElement.lang = safe;
};

export default i18n;
