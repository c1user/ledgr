import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { toast } from "../store/feedbackStore";
import cx from "../lib/cx";
import { Badge, Button, Card, Select } from "../components/ui";

// Mirrors SANDBOX_WATERMARK in backend/src/services/payrollRules.js.
const SANDBOX_WATERMARK = "CÁLCULO NO VERIFICADO — SOLO PRUEBAS";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1];

const STATUS_TONE = {
  done: "income",
  late: "danger",
  ready: "payroll",
  upcoming: "neutral",
};

// obligation_type → export descriptor(s). Quarter derived from the period.
function exportsFor(o) {
  const year = Number(String(o.period_start).slice(0, 4));
  const q = Math.floor(Number(String(o.period_start).slice(5, 7)) / 3) + 1;
  switch (o.obligation_type) {
    case "hacienda_withholding_reconciliation":
      return [{ key: "csv", url: `/payroll-filings/hacienda-quarterly?year=${year}&q=${q}` }];
    case "dtrh_unemployment_sinot":
      return [{ key: "csv", url: `/payroll-filings/dtrh-quarterly?year=${year}&q=${q}` }];
    case "w2pr_annual":
      return [
        { key: "file", url: `/payroll-filings/w2pr?year=${year}` },
        { key: "draft", url: `/payroll-filings/w2pr?year=${year}&draft=1` },
      ];
    case "cfse_declaration": {
      const dueYear = Number(String(o.due_date).slice(0, 4));
      return [{ key: "csv", url: `/payroll-filings/cfse?year=${dueYear}` }];
    }
    default:
      return [];
  }
}

export default function PayrollCompliance() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const canAct = ["owner", "admin"].includes(user?.role);
  const queryClient = useQueryClient();
  const [year, setYear] = useState(CURRENT_YEAR);

  const { data, isLoading } = useQuery({
    queryKey: ["payroll-calendar", year],
    queryFn: () =>
      api.get(`/payroll-filings/calendar?year=${year}`).then((r) => r.data),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, done }) =>
      api.put(`/payroll-filings/calendar/${id}/status`, { done }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["payroll-calendar", year] }),
    onError: (err) =>
      toast.error(err.response?.data?.error || t("common.error")),
  });

  const download = async (url) => {
    try {
      const res = await api.get(url, { responseType: "blob" });
      const disposition = res.headers["content-disposition"] || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = match ? match[1] : "export";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      let message = t("common.error");
      const body = err.response?.data;
      if (body instanceof Blob) {
        try {
          message = JSON.parse(await body.text()).error || message;
        } catch {
          /* keep default */
        }
      }
      toast.error(message);
    }
  };

  const typeLabel = (type) =>
    t(`payrollFilings.type_${type}`, { defaultValue: type });

  return (
    <div className="fade-in max-w-[880px] mx-auto">
      <div className="flex justify-between items-center mb-1.5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">
            {t("payrollFilings.title")}
          </h1>
          <div className="text-md text-muted mt-1">
            {t("payrollFilings.subtitle")}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Select
            className="w-[100px]"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Link
            to="/payroll"
            className="text-[13px] text-brand hover:underline whitespace-nowrap"
          >
            <i className="ti ti-arrow-left mr-1" aria-hidden="true" />
            {t("payroll.title")}
          </Link>
        </div>
      </div>

      {data?.watermark && (
        <Card padding="none" className="p-3.5 mt-4 border border-danger bg-danger-bg">
          <div className="font-bold text-danger text-[13px] tracking-wide">
            <i className="ti ti-flask mr-1.5" aria-hidden="true" />
            {SANDBOX_WATERMARK}
          </div>
          <div className="text-[12px] text-secondary mt-0.5">
            {t("payrollFilings.sandboxExplain")}
          </div>
        </Card>
      )}

      {data?.unverified_schedule_rules?.length > 0 && (
        <Card padding="none" className="p-3 mt-3 border border-line bg-canvas">
          <div className="text-[12px] text-secondary">
            <i className="ti ti-alert-triangle mr-1.5" aria-hidden="true" />
            {t("payrollFilings.unverifiedNote")}{" "}
            <Link to="/payroll/rules" className="text-brand hover:underline">
              {t("payrollRules.title")}
            </Link>
          </div>
        </Card>
      )}

      <Card className="mt-4" padding="none">
        {isLoading ? (
          <div className="p-6 text-center text-muted">{t("common.loading")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-muted uppercase tracking-[0.5px] border-b border-line">
                  <th className="px-4 py-2.5">{t("payrollFilings.colObligation")}</th>
                  <th className="px-4 py-2.5">{t("payrollFilings.colPeriod")}</th>
                  <th className="px-4 py-2.5">{t("payrollFilings.colDue")}</th>
                  <th className="px-4 py-2.5">{t("payrollFilings.colStatus")}</th>
                  <th className="px-4 py-2.5 text-right">
                    {t("payrollFilings.colActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data?.obligations || []).map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">
                      {typeLabel(o.obligation_type)}
                    </td>
                    <td className="px-4 py-3 text-secondary whitespace-nowrap">
                      {dayjs(o.period_start).format("MMM D, YY")} —{" "}
                      {dayjs(o.period_end).format("MMM D, YY")}
                    </td>
                    <td
                      className={cx(
                        "px-4 py-3 whitespace-nowrap",
                        o.display_status === "late"
                          ? "text-danger font-medium"
                          : "text-secondary",
                      )}
                    >
                      {dayjs(o.due_date).format("MMM D, YYYY")}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[o.display_status]}>
                        {t(`payrollFilings.status_${o.display_status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 justify-end flex-wrap">
                        {exportsFor(o).map((ex) => (
                          <Button
                            key={ex.key}
                            size="sm"
                            icon="ti-download"
                            onClick={() => download(ex.url)}
                          >
                            {t(`payrollFilings.export_${ex.key}`)}
                          </Button>
                        ))}
                        {canAct && (
                          <Button
                            size="sm"
                            variant={
                              o.display_status === "done" ? "ghost" : "secondary"
                            }
                            icon={
                              o.display_status === "done"
                                ? "ti-arrow-back-up"
                                : "ti-check"
                            }
                            onClick={() =>
                              statusMutation.mutate({
                                id: o.id,
                                done: o.display_status !== "done",
                              })
                            }
                          >
                            {o.display_status === "done"
                              ? t("payrollFilings.markUndone")
                              : t("payrollFilings.markDone")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="text-[12px] text-muted mt-4 mb-8">
        <i className="ti ti-info-circle mr-1" aria-hidden="true" />
        {t("payrollFilings.disclaimer")}
      </div>
    </div>
  );
}
