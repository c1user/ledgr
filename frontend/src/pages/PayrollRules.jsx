import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { toast, confirmDialog } from "../store/feedbackStore";
import cx from "../lib/cx";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
} from "../components/ui";
import RulePayloadEditor from "../components/payroll/RulePayloadEditor";

// The exact sandbox banner text, verbatim — mirrored from
// backend/src/services/payrollRules.js (SANDBOX_WATERMARK).
const SANDBOX_WATERMARK = "CÁLCULO NO VERIFICADO — SOLO PRUEBAS";

function StatusBadge({ status, t }) {
  return status === "VERIFIED" ? (
    <Badge tone="income" icon="ti-shield-check">
      {t("payrollRules.verified")}
    </Badge>
  ) : (
    <Badge tone="danger" icon="ti-alert-triangle">
      {t("payrollRules.unverified")}
    </Badge>
  );
}

// ── Rule detail / edit modal ──────────────────────────────────
// Receives the FULL rule row (detail endpoint — the list omits payloads).
function RuleModal({ rule, isOwner, onClose, t }) {
  const queryClient = useQueryClient();
  const isVerified = rule.verification_status === "VERIFIED";

  // Structured editing works on an object copy; the raw-JSON toggle is the
  // escape hatch for structural changes (e.g. restructuring bracket tables).
  const [payloadObj, setPayloadObj] = useState(rule.payload);
  const [jsonMode, setJsonMode] = useState(false);
  const [payloadText, setPayloadText] = useState("");
  const [citation, setCitation] = useState(rule.source_citation || "");
  const [attest, setAttest] = useState(false);
  const [payloadError, setPayloadError] = useState("");

  const toggleJsonMode = () => {
    if (!jsonMode) {
      setPayloadText(JSON.stringify(payloadObj, null, 2));
      setJsonMode(true);
      return;
    }
    try {
      setPayloadObj(JSON.parse(payloadText));
      setPayloadError("");
      setJsonMode(false);
    } catch {
      setPayloadError(t("payrollRules.invalidJson"));
    }
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payroll-rules"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-rule", rule.id] });
    queryClient.invalidateQueries({ queryKey: ["payroll-mode"] });
  };

  const saveMutation = useMutation({
    mutationFn: (body) => api.put(`/payroll-rules/${rule.id}`, body),
    onSuccess: () => {
      invalidate();
      toast.success(t("payrollRules.saved"));
      onClose();
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("common.error")),
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      api.put(`/payroll-rules/${rule.id}/verify`, { attest: true }),
    onSuccess: () => {
      invalidate();
      toast.success(t("payrollRules.verifiedToast"));
      onClose();
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("common.error")),
  });

  const unverifyMutation = useMutation({
    mutationFn: () =>
      api.put(`/payroll-rules/${rule.id}/unverify`, { confirm: true }),
    onSuccess: () => {
      invalidate();
      toast.success(t("payrollRules.unverifiedToast"));
      onClose();
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("common.error")),
  });

  const handleSave = () => {
    let payload = payloadObj;
    if (jsonMode) {
      try {
        payload = JSON.parse(payloadText);
      } catch {
        setPayloadError(t("payrollRules.invalidJson"));
        return;
      }
    }
    setPayloadError("");
    saveMutation.mutate({ payload, sourceCitation: citation });
  };

  const typeLabel = t(`payrollRules.type_${rule.rule_type}`, {
    defaultValue: rule.rule_type,
  });

  return (
    <Modal open onClose={onClose} title={typeLabel} size="lg">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <StatusBadge status={rule.verification_status} t={t} />
        <Badge tone="neutral">{rule.jurisdiction}</Badge>
        <span className="text-[12px] text-muted">
          {t("payrollRules.effective")}{" "}
          {dayjs(rule.effective_from).format("MMM D, YYYY")}
          {" — "}
          {rule.effective_to
            ? dayjs(rule.effective_to).format("MMM D, YYYY")
            : t("payrollRules.openEnded")}
        </span>
      </div>

      {isVerified && (
        <div className="text-[12px] text-muted mb-3">
          {t("payrollRules.verifiedBy", {
            name: rule.verified_by_name || "—",
            date: dayjs(rule.verified_at).format("MMM D, YYYY"),
          })}
        </div>
      )}

      <Field label={t("payrollRules.citation")}>
        {isVerified || !isOwner ? (
          <div className="text-[13px] text-ink bg-canvas rounded-lg p-3 break-words">
            {rule.source_citation}
          </div>
        ) : (
          <Input
            value={citation}
            onChange={(e) => setCitation(e.target.value)}
            placeholder={t("payrollRules.citationPlaceholder")}
          />
        )}
      </Field>

      <Field
        label={
          <span className="flex items-center justify-between w-full">
            <span>{t("payrollRules.payload")}</span>
            <button
              type="button"
              onClick={toggleJsonMode}
              className="text-[11px] text-brand hover:underline cursor-pointer font-normal"
            >
              <i
                className={cx("ti mr-1", jsonMode ? "ti-list-details" : "ti-code")}
                aria-hidden="true"
              />
              {jsonMode
                ? t("payrollRules.structuredView")
                : t("payrollRules.jsonView")}
            </button>
          </span>
        }
      >
        {jsonMode ? (
          <textarea
            className={cx(
              "w-full font-mono text-[12px] rounded-lg border border-line bg-canvas p-3 min-h-[220px]",
              "focus:outline-none focus:ring-2 focus:ring-brand/40",
              (isVerified || !isOwner) && "opacity-70",
            )}
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            readOnly={isVerified || !isOwner}
            spellCheck={false}
          />
        ) : (
          <RulePayloadEditor
            payload={payloadObj}
            onChange={setPayloadObj}
            readOnly={isVerified || !isOwner}
            t={t}
          />
        )}
        {payloadError && (
          <div className="text-[12px] text-danger mt-1">{payloadError}</div>
        )}
      </Field>

      {rule.notes && (
        <div className="text-[12px] text-muted mb-3 bg-canvas rounded-lg p-3">
          <i className="ti ti-info-circle mr-1" aria-hidden="true" />
          {rule.notes}
        </div>
      )}

      {isOwner && !isVerified && (
        <label className="flex items-start gap-2 mt-1 text-[13px] text-ink cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={attest}
            onChange={(e) => setAttest(e.target.checked)}
          />
          <span>{t("payrollRules.attestLabel")}</span>
        </label>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        {isOwner && !isVerified && (
          <>
            <Button
              variant="secondary"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              {t("common.save")}
            </Button>
            <Button
              variant="primary"
              icon="ti-shield-check"
              disabled={!attest || verifyMutation.isPending}
              onClick={() => verifyMutation.mutate()}
            >
              {t("payrollRules.verifyAction")}
            </Button>
          </>
        )}
        {isOwner && isVerified && (
          <Button
            variant="danger"
            icon="ti-shield-off"
            disabled={unverifyMutation.isPending}
            onClick={async () => {
              if (
                await confirmDialog({
                  message: t("payrollRules.confirmUnverify"),
                  confirmLabel: t("payrollRules.unverifyAction"),
                  danger: true,
                })
              )
                unverifyMutation.mutate();
            }}
          >
            {t("payrollRules.unverifyAction")}
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function PayrollRules() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["payroll-rules"],
    queryFn: () => api.get("/payroll-rules").then((r) => r.data),
  });

  const { data: modeData } = useQuery({
    queryKey: ["payroll-mode"],
    queryFn: () => api.get("/payroll-rules/mode").then((r) => r.data),
  });

  // Detail row (with payload) for the open modal.
  const { data: selectedRule } = useQuery({
    queryKey: ["payroll-rule", selectedId],
    queryFn: () =>
      api.get(`/payroll-rules/${selectedId}`).then((r) => r.data),
    enabled: !!selectedId,
  });

  const mode = modeData?.payroll_mode || "sandbox";
  const unverifiedCount = Number(modeData?.unverified_count ?? 0);
  const verifiedCount = rules.filter(
    (r) => r.verification_status === "VERIFIED",
  ).length;

  const modeMutation = useMutation({
    mutationFn: (newMode) => api.put("/payroll-rules/mode", { mode: newMode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-mode"] });
      toast.success(t("payrollRules.modeChanged"));
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("common.error")),
  });

  const switchMode = async () => {
    const target = mode === "sandbox" ? "production" : "sandbox";
    if (target === "production") {
      const ok = await confirmDialog({
        message:
          unverifiedCount > 0
            ? t("payrollRules.confirmProductionBlocked", {
                count: unverifiedCount,
              })
            : t("payrollRules.confirmProduction"),
        confirmLabel: t("payrollRules.switchToProduction"),
        danger: unverifiedCount > 0,
      });
      if (!ok) return;
    }
    modeMutation.mutate(target);
  };

  return (
    <div className="fade-in max-w-[880px] mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-1.5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">
            {t("payrollRules.title")}
          </h1>
          <div className="text-md text-muted mt-1">
            {t("payrollRules.subtitle")}
          </div>
        </div>
        <Link to="/payroll" className="text-[13px] text-brand hover:underline">
          <i className="ti ti-arrow-left mr-1" aria-hidden="true" />
          {t("payroll.title")}
        </Link>
      </div>

      {/* Mode banner */}
      <Card
        padding="none"
        className={cx(
          "p-4 mt-4 border",
          mode === "sandbox"
            ? "border-danger bg-danger-bg"
            : "border-income bg-income-bg",
        )}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            {mode === "sandbox" ? (
              <>
                <div className="font-bold text-danger text-[14px] tracking-wide">
                  <i className="ti ti-flask mr-1.5" aria-hidden="true" />
                  {SANDBOX_WATERMARK}
                </div>
                <div className="text-[12px] text-secondary mt-1">
                  {t("payrollRules.sandboxExplain")}
                </div>
              </>
            ) : (
              <>
                <div className="font-bold text-income text-[14px]">
                  <i className="ti ti-shield-check mr-1.5" aria-hidden="true" />
                  {t("payrollRules.productionMode")}
                </div>
                <div className="text-[12px] text-secondary mt-1">
                  {t("payrollRules.productionExplain")}
                </div>
              </>
            )}
          </div>
          {isOwner && (
            <Button
              variant="secondary"
              size="sm"
              onClick={switchMode}
              disabled={modeMutation.isPending}
            >
              {mode === "sandbox"
                ? t("payrollRules.switchToProduction")
                : t("payrollRules.switchToSandbox")}
            </Button>
          )}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
        <Card padding="none" className="p-3.5">
          <div className="text-[11px] text-muted mb-1">
            {t("payrollRules.totalRules")}
          </div>
          <div className="text-lg font-bold text-ink">{rules.length}</div>
        </Card>
        <Card padding="none" className="p-3.5">
          <div className="text-[11px] text-muted mb-1">
            {t("payrollRules.verified")}
          </div>
          <div className="text-lg font-bold text-income">{verifiedCount}</div>
        </Card>
        <Card padding="none" className="p-3.5">
          <div className="text-[11px] text-muted mb-1">
            {t("payrollRules.unverified")}
          </div>
          <div
            className={cx(
              "text-lg font-bold",
              unverifiedCount > 0 ? "text-danger" : "text-ink",
            )}
          >
            {unverifiedCount}
          </div>
        </Card>
      </div>

      {/* Rules table */}
      <Card className="mt-4" padding="none">
        {isLoading ? (
          <div className="p-6 text-center text-muted">
            {t("common.loading")}
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon="ti-scale"
            title={t("payrollRules.noRules")}
            message={t("payrollRules.noRulesHint")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-muted uppercase tracking-[0.5px] border-b border-line">
                  <th className="px-4 py-2.5">{t("payrollRules.colRule")}</th>
                  <th className="px-4 py-2.5">
                    {t("payrollRules.colJurisdiction")}
                  </th>
                  <th className="px-4 py-2.5">
                    {t("payrollRules.colEffective")}
                  </th>
                  <th className="px-4 py-2.5">{t("payrollRules.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-line last:border-0 hover:bg-canvas cursor-pointer"
                    onClick={() => setSelectedId(rule.id)}
                  >
                    <td className="px-4 py-3 font-medium text-ink">
                      {t(`payrollRules.type_${rule.rule_type}`, {
                        defaultValue: rule.rule_type,
                      })}
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      {rule.jurisdiction}
                    </td>
                    <td className="px-4 py-3 text-secondary whitespace-nowrap">
                      {dayjs(rule.effective_from).format("MMM D, YYYY")}
                      {" — "}
                      {rule.effective_to
                        ? dayjs(rule.effective_to).format("MMM D, YYYY")
                        : t("payrollRules.openEnded")}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={rule.verification_status} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Disclaimer */}
      <div className="text-[12px] text-muted mt-4 mb-8">
        <i className="ti ti-info-circle mr-1" aria-hidden="true" />
        {t("payrollRules.disclaimer")}
      </div>

      {selectedId && selectedRule && (
        <RuleModal
          key={selectedRule.id}
          rule={selectedRule}
          isOwner={isOwner}
          onClose={() => setSelectedId(null)}
          t={t}
        />
      )}
    </div>
  );
}
