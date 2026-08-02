import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import BRAND from "../config/brand";
import BrandMark from "../components/BrandMark";
import { Button, Card } from "../components/ui";

// Public: /unsubscribe?token=…&category=… — the one-click link at the
// bottom of every preference-gated email. Works logged-out.
export default function Unsubscribe() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token");
  const category = params.get("category") || "all";

  const { isPending, isError, error, isSuccess } = useQuery({
    queryKey: ["unsubscribe", token, category],
    enabled: !!token,
    // One attempt only — same single-shot pattern as VerifyEmail.
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    queryFn: () =>
      api
        .post("/notifications/unsubscribe", { token, category })
        .then((r) => r.data),
  });

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <Card padding="lg" className="w-full max-w-[400px] fade-in text-center">
        <BrandMark size={52} className="mx-auto mb-3" />
        <div className="font-display text-brand text-[22px] font-bold tracking-[4px] uppercase mb-5">
          {BRAND.name}
        </div>

        {!token ? (
          <p className="text-md text-secondary my-4">{t("unsub.noToken")}</p>
        ) : isPending ? (
          <i
            className="ti ti-loader-2 animate-spin text-3xl text-muted"
            aria-hidden="true"
          />
        ) : isError ? (
          <p className="text-md text-secondary my-4">
            {error.response?.data?.error || t("unsub.failed")}
          </p>
        ) : (
          isSuccess && (
            <>
              <i
                className="ti ti-mail-off text-3xl text-income"
                aria-hidden="true"
              />
              <p className="text-md text-secondary my-4">{t("unsub.done")}</p>
              <p className="text-xs text-muted mb-4">{t("unsub.manageHint")}</p>
            </>
          )
        )}

        <Link to="/login">
          <Button variant="primary" full icon="ti-arrow-right">
            {t("verify.toLogin")}
          </Button>
        </Link>
      </Card>
    </div>
  );
}
