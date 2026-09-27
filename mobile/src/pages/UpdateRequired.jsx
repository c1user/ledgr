import { useTranslation } from "react-i18next";
import { Button } from "@abaco/ui";
import BrandMark from "@abaco/ui/BrandMark";
import { openExternal } from "../native/browser.js";

const WEB_URL = "https://abacopr.com";

/**
 * Shown when GET /api/meta.minMobileBuild is above this build: the API no
 * longer supports this version. Neutral wording — no store links (the store
 * itself handles updates); the web app is always available.
 */
export default function UpdateRequired() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas px-6 text-center pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <BrandMark size={56} />
      <h1 className="text-lg font-semibold text-ink">
        {t("mobile.common.updateRequiredTitle")}
      </h1>
      <p className="text-md text-muted max-w-sm">
        {t("mobile.common.updateRequiredBody")}
      </p>
      <Button
        variant="primary"
        size="lg"
        icon="ti-external-link"
        onClick={() => openExternal(WEB_URL)}
      >
        {t("mobile.common.openWeb")}
      </Button>
    </div>
  );
}
