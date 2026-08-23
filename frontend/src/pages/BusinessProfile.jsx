import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { downloadFile } from "../lib/download";
import useAuthStore from "../store/authStore";
import { toast } from "../store/feedbackStore";
import { Button, Card, Field, Input, Modal, PageHeader } from "../components/ui";

// Business (payer) profile — EIN + mailing address. These fill the 480.6SP
// "informante" block, which the Hacienda export requires before it will run.
export default function BusinessProfile() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isOwner = user?.role === "owner";

  // Close-business modal state
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeForm, setCloseForm] = useState({ confirmName: "", password: "" });
  const [closeError, setCloseError] = useState("");
  const [form, setForm] = useState({
    name: "",
    taxId: "",
    merchantRegistrationNumber: "",
    address: "",
    city: "",
    state: "",
    zip: "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["business"],
    queryFn: () => api.get("/business").then((r) => r.data),
  });

  // Seed local form when the business loads/changes — guarded during render
  // rather than in an effect (per the codebase pattern in Budget.jsx).
  const dataKey = data ? JSON.stringify(data) : "";
  const [seededKey, setSeededKey] = useState("");
  if (data && dataKey !== seededKey) {
    setSeededKey(dataKey);
    setForm({
      name: data.name || "",
      taxId: data.tax_id || "",
      merchantRegistrationNumber: data.merchant_registration_number || "",
      address: data.address || "",
      city: data.city || "",
      state: data.state || "",
      zip: data.zip || "",
    });
  }

  const exportData = useMutation({
    mutationFn: () =>
      downloadFile(
        "/business/export",
        `abaco-export-${new Date().toISOString().slice(0, 10)}.json`,
      ),
    onSuccess: () => toast.success(t("dataRights.exportDone")),
    onError: () => toast.error(t("dataRights.exportFailed")),
  });

  const closeBusiness = useMutation({
    mutationFn: () =>
      api
        .delete("/business", {
          data: {
            password: closeForm.password,
            confirmName: closeForm.confirmName,
          },
        })
        .then((r) => r.data),
    onSuccess: () => {
      logout();
      navigate("/login");
    },
    onError: (err) =>
      setCloseError(err.response?.data?.error || t("dataRights.closeFailed")),
  });

  const save = useMutation({
    mutationFn: (payload) => api.put("/business", payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business"] });
      setSaved(true);
      setError("");
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("business.saveFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError(t("business.errNameRequired"));
    setError("");
    save.mutate(form);
  };

  const field = (key, label, props = {}) => (
    <Field label={label} htmlFor={key} className="mb-0">
      <Input
        id={key}
        type="text"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...props}
      />
    </Field>
  );

  return (
    <div className="fade-in max-w-[620px] mx-auto">
      <PageHeader title={t("business.title")} subtitle={t("business.subtitle")} />

      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-muted">{t("common.loading")}</div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card padding="none" className="p-5 mb-4">
            <div className="flex flex-col gap-3.5">
              {field("name", t("business.name"))}
              {field("taxId", t("business.ein"), {
                placeholder: t("business.einPlaceholder"),
              })}
              {field("merchantRegistrationNumber", t("business.merchantReg"), {
                placeholder: t("business.merchantRegPlaceholder"),
              })}
              {field("address", t("business.address"))}
              <div className="grid grid-cols-[1fr_100px_110px] gap-3">
                {field("city", t("business.city"))}
                {field("state", t("business.state"))}
                {field("zip", t("business.zip"))}
              </div>
            </div>
          </Card>

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending ? t("business.saving") : t("business.save")}
            </Button>
            {saved && (
              <span className="text-xs text-income">
                <i className="ti ti-check mr-1" aria-hidden="true" />
                {t("business.saved")}
              </span>
            )}
          </div>
        </form>
      )}

      {/* Data rights — owner only (V3 Phase 6) */}
      {isOwner && !isLoading && (
        <>
          <Card className="mt-6 mb-4">
            <h2 className="text-md font-semibold text-ink mb-1">
              {t("dataRights.exportTitle")}
            </h2>
            <p className="text-md text-muted mb-3">
              {t("dataRights.exportHint")}
            </p>
            <Button
              icon="ti-download"
              loading={exportData.isPending}
              onClick={() => exportData.mutate()}
            >
              {t("dataRights.exportButton")}
            </Button>
          </Card>

          <Card className="border-danger">
            <h2 className="text-md font-semibold text-danger mb-1">
              {t("dataRights.closeTitle")}
            </h2>
            <p className="text-md text-muted mb-3">
              {t("dataRights.closeHint")}
            </p>
            <Button
              variant="danger"
              icon="ti-trash"
              onClick={() => {
                setCloseForm({ confirmName: "", password: "" });
                setCloseError("");
                setCloseOpen(true);
              }}
            >
              {t("dataRights.closeButton")}
            </Button>
          </Card>

          <Modal
            open={closeOpen}
            onClose={() => setCloseOpen(false)}
            title={t("dataRights.closeTitle")}
            size="sm"
            footer={
              <>
                <Button onClick={() => setCloseOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="danger"
                  icon="ti-trash"
                  loading={closeBusiness.isPending}
                  disabled={closeForm.confirmName !== (data?.name || "")}
                  onClick={() => closeBusiness.mutate()}
                >
                  {t("dataRights.closeConfirm")}
                </Button>
              </>
            }
          >
            <p className="text-md text-secondary mb-4">
              {t("dataRights.closeWarning")}
            </p>

            {closeError && (
              <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
                {closeError}
              </div>
            )}

            <Field
              label={t("dataRights.closeTypeName", { name: data?.name || "" })}
              htmlFor="close-name"
              className="mb-3.5"
            >
              <Input
                id="close-name"
                type="text"
                value={closeForm.confirmName}
                onChange={(e) => {
                  setCloseForm({ ...closeForm, confirmName: e.target.value });
                  setCloseError("");
                }}
                placeholder={data?.name || ""}
              />
            </Field>
            <Field
              label={t("dataRights.closePassword")}
              htmlFor="close-password"
              className="mb-1"
            >
              <Input
                id="close-password"
                type="password"
                value={closeForm.password}
                onChange={(e) => {
                  setCloseForm({ ...closeForm, password: e.target.value });
                  setCloseError("");
                }}
              />
            </Field>
          </Modal>
        </>
      )}
    </div>
  );
}
