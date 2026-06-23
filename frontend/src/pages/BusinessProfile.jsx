import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";

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
    <div>
      <label className="label" htmlFor={key}>
        {label}
      </label>
      <input
        id={key}
        className="input"
        type="text"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...props}
      />
    </div>
  );

  return (
    <div className="fade-in" style={{ maxWidth: 620, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        {t("business.title")}
      </h1>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
        {t("business.subtitle")}
      </div>

      {error && (
        <div
          style={{
            background: "var(--danger-bg)",
            color: "var(--danger)",
            border: "0.5px solid var(--danger)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {t("common.loading")}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {field("name", t("business.name"))}
              {field("taxId", t("business.ein"), {
                placeholder: t("business.einPlaceholder"),
              })}
              {field("address", t("business.address"))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 110px", gap: 12 }}>
                {field("city", t("business.city"))}
                {field("state", t("business.state"))}
                {field("zip", t("business.zip"))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? t("business.saving") : t("business.save")}
            </button>
            {saved && (
              <span style={{ fontSize: 12, color: "var(--income)" }}>
                <i className="ti ti-check" style={{ marginRight: 4 }} />
                {t("business.saved")}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
