import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import dayjs from "dayjs";
import "dayjs/locale/es";
import en from "./locales/en.json";
import es from "./locales/es.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: "en", // Overwritten by setAppLanguage() once the user loads
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

/**
 * Single entry point for changing the app language.
 * Keeps i18next, dayjs, and the <html lang> attribute in sync.
 */
export const setAppLanguage = (lang) => {
  const safe = lang === "es" ? "es" : "en";
  i18n.changeLanguage(safe);
  dayjs.locale(safe);
  document.documentElement.lang = safe;
};

export default i18n;
