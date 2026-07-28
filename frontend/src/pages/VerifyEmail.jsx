import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import BRAND from "../config/brand";
import BrandMark from "../components/BrandMark";
import { Button, Card } from "../components/ui";

// Public: /verify-email?token=… — consumes the emailed verification link.
// Works logged-in or logged-out; the token itself is the proof.
export default function VerifyEmail() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token");
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const { isPending, isError, error, isSuccess } = useQuery({
    queryKey: ["verify-email", token],
    enabled: !!token,
    // The token is single-use: one attempt, never refetched or retried —
    // a focus-triggered second POST would see the cleared token and "fail".
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    queryFn: () =>
      api.post("/auth/verify-email", { token }).then((r) => {
        // If this browser is logged in, clear the in-app nudge immediately.
        if (useAuthStore.getState().user) setUser({ emailVerified: true });
        return r.data;
      }),
  });

  const body = !token ? (
    <>
      <i className="ti ti-mail-question text-3xl text-muted" aria-hidden="true" />
      <p className="text-md text-secondary my-4">{t("verify.noToken")}</p>
    </>
  ) : isPending ? (
    <>
      <i
        className="ti ti-loader-2 animate-spin text-3xl text-muted"
        aria-hidden="true"
      />
      <p className="text-md text-secondary my-4">{t("verify.checking")}</p>
    </>
  ) : isError ? (
    <>
      <i className="ti ti-circle-x text-3xl text-danger" aria-hidden="true" />
      <p className="text-md text-secondary my-4">
        {error.response?.data?.error || t("verify.failed")}
      </p>
      <p className="text-xs text-muted mb-4">{t("verify.failedHint")}</p>
    </>
  ) : (
    isSuccess && (
      <>
        <i
          className="ti ti-circle-check text-3xl text-income"
          aria-hidden="true"
        />
        <p className="text-md text-secondary my-4">{t("verify.done")}</p>
      </>
    )
  );

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <Card padding="lg" className="w-full max-w-[400px] fade-in text-center">
        <BrandMark size={52} className="mx-auto mb-3" />
        <div className="font-display text-brand text-[22px] font-bold tracking-[4px] uppercase mb-5">
          {BRAND.name}
        </div>

        {body}

        <Link to={user ? "/dashboard" : "/login"}>
          <Button variant="primary" full icon="ti-arrow-right">
            {user ? t("verify.toDashboard") : t("verify.toLogin")}
          </Button>
        </Link>
      </Card>
    </div>
  );
}
