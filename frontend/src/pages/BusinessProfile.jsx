import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";

// Business (payer) profile — EIN + mailing address. These fill the 480.6SP
// "informante" block, which the Hacienda export requires before it will run.
export default function BusinessProfile() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    taxId: "",
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
      address: data.address || "",
      city: data.city || "",
      state: data.state || "",
      zip: data.zip || "",
    });
  }

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
    </div>
  );
}
