import { useTranslation } from "react-i18next";
import { Button } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import useThemeStore from "../../store/themeStore.js";

/**
 * Corner light/dark switch for the pre-sign-in screens (same idea as the
 * web login). Flips between the explicit themes based on what is currently
 * resolved; "system" is still available from Settings once signed in.
 */
export default function ThemeToggle({ className }) {
  const { t } = useTranslation();
  const resolved = useThemeStore((s) => s.resolved);
  const setTheme = useThemeStore((s) => s.setTheme);
  const dark = resolved === "dark";
  const label = dark ? t("nav.lightMode") : t("nav.darkMode");

  return (
    <Button
      variant="ghost"
      size="md"
      icon={dark ? "ti-sun" : "ti-moon"}
      aria-label={label}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={cx("min-h-[44px]", className)}
    >
      {label}
    </Button>
  );
}
