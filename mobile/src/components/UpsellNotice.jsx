import { useTranslation } from "react-i18next";
import { Card } from "@abaco/ui";
import cx from "@abaco/ui/cx";

// Plan gates on the phone are INFORMATIONAL TEXT ONLY (owner decision; App
// Store 3.1.1 / Play policy): no prices, no purchase buttons, no links.
// feature: "ai_chat" (Premium) | "ai_receipts" (Starter meter exhausted).
const KEYS = {
  ai_chat: "mobile.upsell.assistantPremium",
  ai_receipts: "mobile.upsell.scansLimit",
};

export default function UpsellNotice({ feature, used, limit, className }) {
  const { t } = useTranslation();
  const key = KEYS[feature] || KEYS.ai_chat;
  return (
    <Card
      padding="sm"
      className={cx(
        "flex items-start gap-3 bg-brand-light border-0",
        className,
      )}
      role="note"
    >
      <i
        className="ti ti-info-circle text-brand text-lg shrink-0 mt-px"
        aria-hidden="true"
      />
      <p className="text-md text-ink">{t(key, { used, limit })}</p>
    </Card>
  );
}
