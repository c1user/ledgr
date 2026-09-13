import { useTranslation } from "react-i18next";
import useThemeStore from "../store/themeStore";
import LanguageToggle from "../components/LanguageToggle";
import cx from "../lib/cx";
import { Card, PageHeader } from "../components/ui";

// Settings → Preferences: language (saved to the account, follows the user
// everywhere) and theme (saved on this device, like the sidebar switch).
const THEMES = [
  { id: "light", icon: "ti-sun", labelKey: "settings.themeLight" },
  { id: "dark", icon: "ti-moon", labelKey: "settings.themeDark" },
];

export default function Preferences() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className="fade-in max-w-[620px] mx-auto">
      <PageHeader
        title={t("settings.preferencesTitle")}
        subtitle={t("settings.preferencesSubtitle")}
      />

      {/* Language */}
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-md font-semibold text-ink mb-1">
              {t("settings.languageTitle")}
            </h2>
            <p className="text-md text-muted">{t("settings.languageHint")}</p>
          </div>
          <LanguageToggle />
        </div>
      </Card>

      {/* Theme */}
      <Card>
        <h2 className="text-md font-semibold text-ink mb-1">
          {t("settings.themeTitle")}
        </h2>
        <p className="text-md text-muted mb-3">{t("settings.themeHint")}</p>
        <div
          className="grid grid-cols-2 gap-3"
          role="radiogroup"
          aria-label={t("settings.themeTitle")}
        >
          {THEMES.map((th) => {
            const active = theme === th.id;
            return (
              <button
                key={th.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(th.id)}
                className={cx(
                  "flex items-center gap-3 px-4 py-3 rounded-lg border text-left cursor-pointer transition-colors",
                  active
                    ? "border-brand bg-brand-light text-brand"
                    : "border-line bg-surface text-secondary hover:border-line-hover hover:text-ink",
                )}
              >
                <i className={`ti ${th.icon} text-xl`} aria-hidden="true" />
                <span className="text-md font-medium">{t(th.labelKey)}</span>
                {active && (
                  <i className="ti ti-check ml-auto" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
