import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import dayjs from "dayjs";

const IVU_DEFAULT_RATE = 11.5;

const makeFmt = (lang) => (val) =>
  new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(val || 0);

const coaName = (a, t) => (a.name_key ? t(a.name_key) : a.name);

const STATUS_COLORS = {
  draft: { bg: "var(--bg-secondary)", fg: "var(--text-muted)" },
  sent: { bg: "var(--brand-light)", fg: "var(--brand)" },
  overdue: { bg: "var(--expense-bg)", fg: "var(--expense)" },
  paid: { bg: "var(--income-bg)", fg: "var(--income)" },
  void: { bg: "var(--bg-secondary)", fg: "var(--text-muted)" },
};

// Confidence indicator for AI-drafted line items (#12).
const CONFIDENCE_COLORS = {
  high: "var(--income, #22c55e)",
  medium: "#eab308",
  low: "var(--expense, #ef4444)",
};

// Flatten the grouped chart-of-accounts response into a flat list of one type.
function accountsOfType(grouped, type) {
  const group = (grouped || []).find((g) => g.account_type === type);
  if (!group) return [];
  const out = [];
  const walk = (nodes) =>
    nodes.forEach((n) => {
      out.push(n);
      if (n.children?.length) walk(n.children);
    });
  walk(group.accounts);
  return out;
}

// ── Bilingual labels for the printed invoice (no i18n in print window) ──
const PRINT_LABELS = {
  en: {
    invoice: "INVOICE",
    billTo: "Bill To",
    issueDate: "Issue date",
    dueDate: "Due date",
    description: "Description",
    qty: "Qty",
    unitPrice: "Unit price",
    amount: "Amount",
    subtotal: "Subtotal",
    tax: "Tax",
    ivu: "IVU (sales tax)",
    total: "Total",
    notes: "Notes",
    status: "Status",
  },
  es: {
    invoice: "FACTURA",
    billTo: "Facturar a",
    issueDate: "Fecha de emisión",
    dueDate: "Fecha de vencimiento",
    description: "Descripción",
    qty: "Cant.",
    unitPrice: "Precio unitario",
    amount: "Importe",
    subtotal: "Subtotal",
    tax: "Impuesto",
    ivu: "IVU (impuesto sobre ventas)",
    total: "Total",
    notes: "Notas",
    status: "Estado",
  },
};

function openPrintWindow(invoice, businessName) {
  const lang = invoice.language === "es" ? "es" : "en";
  const L = PRINT_LABELS[lang];
  const money = (v) =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(v) || 0);
  const d = (v) =>
    dayjs(v).locale ? dayjs(v).format("YYYY-MM-DD") : v;

  const rows = (invoice.line_items || [])
    .map(
      (li) => `
      <tr>
        <td>${escapeHtml(li.description)}</td>
        <td class="num">${Number(li.quantity)}</td>
        <td class="num">${money(li.unit_price)}</td>
        <td class="num">${money(li.total)}</td>
      </tr>`,
    )
    .join("");

  const taxLabel = invoice.tax_type === "ivu" ? L.ivu : L.tax;
  const taxRow =
    Number(invoice.tax_total) > 0
      ? `<tr><td colspan="3" class="num label">${taxLabel} (${Number(
          invoice.tax_rate,
        )}%)</td><td class="num">${money(invoice.tax_total)}</td></tr>`
      : "";

  const billTo = [
    invoice.client_name,
    invoice.billing_address,
    [invoice.client_city, invoice.client_state, invoice.client_zip]
      .filter(Boolean)
      .join(", "),
    invoice.billing_email,
  ]
    .filter(Boolean)
    .map((l) => `<div>${escapeHtml(l)}</div>`)
    .join("");

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
  <title>${escapeHtml(invoice.invoice_number)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; margin: 40px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
    .biz { font-size: 20px; font-weight: 700; }
    h1 { font-size: 26px; letter-spacing: 2px; margin: 0; color: #444; }
    .meta { text-align: right; font-size: 13px; color: #555; margin-top: 6px; }
    .meta b { color: #1a1a1a; }
    .billto { font-size: 13px; color: #333; margin-bottom: 24px; line-height: 1.5; }
    .billto .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; border-bottom: 2px solid #1a1a1a; padding: 8px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
    td { padding: 8px 6px; border-bottom: 1px solid #eee; }
    .num { text-align: right; }
    .label { color: #666; }
    tfoot td { border: none; padding-top: 8px; }
    tfoot .total td { font-size: 16px; font-weight: 700; border-top: 2px solid #1a1a1a; }
    .notes { margin-top: 28px; font-size: 12px; color: #555; }
    .notes .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 4px; }
    @media print { body { margin: 0; padding: 24px; } }
  </style></head><body>
    <div class="head">
      <div>
        <div class="biz">${escapeHtml(businessName || "")}</div>
      </div>
      <div>
        <h1>${L.invoice}</h1>
        <div class="meta">
          <div><b>${escapeHtml(invoice.invoice_number)}</b></div>
          <div>${L.issueDate}: ${d(invoice.issue_date)}</div>
          <div>${L.dueDate}: ${d(invoice.due_date)}</div>
        </div>
      </div>
    </div>
    <div class="billto">
      <div class="lbl">${L.billTo}</div>
      ${billTo}
    </div>
    <table>
      <thead>
        <tr>
          <th>${L.description}</th>
          <th class="num">${L.qty}</th>
          <th class="num">${L.unitPrice}</th>
          <th class="num">${L.amount}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="3" class="num label">${L.subtotal}</td><td class="num">${money(
          invoice.subtotal,
        )}</td></tr>
        ${taxRow}
        <tr class="total"><td colspan="3" class="num">${L.total}</td><td class="num">${money(
          invoice.total,
        )}</td></tr>
      </tfoot>
    </table>
    ${
      invoice.notes
        ? `<div class="notes"><div class="lbl">${L.notes}</div>${escapeHtml(
            invoice.notes,
          )}</div>`
        : ""
    }
    <script>window.onload = function(){ window.print(); }</script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

// ── Invoice builder modal ─────────────────────────────────────
function InvoiceModal({ invoice, clients, revenueAccounts, onClose, t, lang }) {
  const isEdit = !!invoice?.id;
  const qc = useQueryClient();
  const fmt = makeFmt(lang);

  const today = dayjs().format("YYYY-MM-DD");
  const initialClient = invoice
    ? clients.find((c) => c.id === invoice.client_id)
    : null;

  const [form, setForm] = useState(() => ({
    clientId: invoice?.client_id || "",
    issueDate: invoice?.issue_date
      ? dayjs(invoice.issue_date).format("YYYY-MM-DD")
      : today,
    dueDate: invoice?.due_date
      ? dayjs(invoice.due_date).format("YYYY-MM-DD")
      : dayjs()
          .add(initialClient?.payment_terms_days ?? 30, "day")
          .format("YYYY-MM-DD"),
    taxType: invoice?.tax_type || "generic",
    taxRate: invoice ? Number(invoice.tax_rate) : 0,
    incomeAccountId: invoice?.income_account_id || "",
    language: invoice?.language || lang,
    notes: invoice?.notes || "",
  }));
  const [items, setItems] = useState(() =>
    invoice?.line_items?.length
      ? invoice.line_items.map((li) => ({
          description: li.description,
          quantity: String(Number(li.quantity)),
          unit_price: String(Number(li.unit_price)),
        }))
      : [{ description: "", quantity: "1", unit_price: "" }],
  );
  const [error, setError] = useState("");

  // AI draft (#12) — natural language → editable line items, never auto-saved.
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [aiError, setAiError] = useState("");
  const aiDraft = useMutation({
    mutationFn: () =>
      api
        .post("/invoices/ai-draft", {
          prompt: aiPrompt,
          clientId: form.clientId || null,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setItems(
        data.line_items.map((li) => ({
          description: li.description,
          quantity: String(li.quantity),
          unit_price: String(li.unit_price),
          confidence: li.confidence,
        })),
      );
      setAiNotes(data.notes || "");
      setAiError("");
    },
    onError: (err) =>
      setAiError(err.response?.data?.error || t("invoices.aiDraftFailed")),
  });
  function handleAiDraft() {
    if (!aiPrompt.trim()) return setAiError(t("invoices.aiDraftEmpty"));
    setAiError("");
    aiDraft.mutate();
  }
  const hasConfidence = items.some((it) => it.confidence);

  const selectedClient = clients.find((c) => c.id === form.clientId);
  const taxExempt = !!selectedClient?.tax_exempt;

  const subtotal = items.reduce(
    (s, it) =>
      s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0),
    0,
  );
  const effectiveRate = taxExempt ? 0 : parseFloat(form.taxRate) || 0;
  const taxTotal = (subtotal * effectiveRate) / 100;
  const total = subtotal + taxTotal;

  function setClient(clientId) {
    const c = clients.find((x) => x.id === clientId);
    setForm((f) => ({
      ...f,
      clientId,
      dueDate: dayjs(f.issueDate)
        .add(c?.payment_terms_days ?? 30, "day")
        .format("YYYY-MM-DD"),
    }));
  }

  function setTaxType(taxType) {
    setForm((f) => ({
      ...f,
      taxType,
      taxRate:
        taxType === "ivu"
          ? f.taxRate > 0
            ? f.taxRate
            : IVU_DEFAULT_RATE
          : f.taxRate,
    }));
  }

  function updateItem(i, key, val) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
  }
  function addItem() {
    setItems((arr) => [...arr, { description: "", quantity: "1", unit_price: "" }]);
  }
  function removeItem(i) {
    setItems((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));
  }

  const saveMutation = useMutation({
    mutationFn: (data) =>
      isEdit
        ? api.put(`/invoices/${invoice.id}`, data).then((r) => r.data)
        : api.post("/invoices", data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("invoices.saveFailed")),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.clientId) return setError(t("invoices.errClientRequired"));
    const cleaned = items
      .map((it) => ({
        description: it.description.trim(),
        quantity: parseFloat(it.quantity),
        unit_price: parseFloat(it.unit_price),
      }))
      .filter((it) => it.description);
    if (cleaned.length === 0) return setError(t("invoices.errLineRequired"));
    for (const it of cleaned) {
      if (!(it.quantity > 0) || !(it.unit_price >= 0)) {
        return setError(t("invoices.errLineValues"));
      }
    }
    setError("");
    saveMutation.mutate({
      clientId: form.clientId,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      taxType: form.taxType,
      taxRate: effectiveRate,
      incomeAccountId: form.incomeAccountId || null,
      language: form.language,
      notes: form.notes,
      lineItems: cleaned,
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="card fade-in"
        style={{
          width: "100%",
          maxWidth: 640,
          padding: 24,
          maxHeight: "92vh",
          overflow: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 700,
              margin: 0,
              color: "var(--text-primary)",
            }}
          >
            {isEdit ? t("invoices.editInvoice") : t("invoices.newInvoice")}
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        {error && (
          <div
            style={{
              fontSize: 13,
              color: "var(--expense, #ef4444)",
              background: "var(--expense-bg)",
              borderRadius: 6,
              padding: "8px 12px",
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {!isEdit && (
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <label
                className="label"
                style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}
              >
                <i className="ti ti-sparkles" style={{ color: "var(--brand)" }} />
                {t("invoices.aiDraftTitle")}
              </label>
              <textarea
                className="input"
                rows={2}
                placeholder={t("invoices.aiDraftPlaceholder")}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                style={{ resize: "vertical", minHeight: 46 }}
              />
              {aiError && (
                <div style={{ fontSize: 12, color: "var(--expense, #ef4444)" }}>
                  {aiError}
                </div>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleAiDraft}
                disabled={aiDraft.isPending}
                style={{
                  alignSelf: "flex-start",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <i className="ti ti-sparkles" style={{ fontSize: 13 }} />
                {aiDraft.isPending
                  ? t("invoices.aiDraftGenerating")
                  : t("invoices.aiDraftGenerate")}
              </button>
            </div>
          )}

          <div>
            <label className="label">{t("invoices.clientLabel")}</label>
            <select
              className="input"
              value={form.clientId}
              onChange={(e) => setClient(e.target.value)}
            >
              <option value="">{t("invoices.selectClient")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {taxExempt && (
              <div
                style={{ fontSize: 11, color: "var(--income)", marginTop: 4 }}
              >
                {t("invoices.clientTaxExempt")}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label className="label">{t("invoices.issueDate")}</label>
              <input
                className="input"
                type="date"
                value={form.issueDate}
                onChange={(e) =>
                  setForm({ ...form, issueDate: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label">{t("invoices.dueDate")}</label>
              <input
                className="input"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <label className="label">{t("invoices.lineItems")}</label>

            {aiNotes && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  background: "var(--brand-light)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  marginBottom: 8,
                  display: "flex",
                  gap: 6,
                }}
              >
                <i
                  className="ti ti-info-circle"
                  style={{ color: "var(--brand)", flexShrink: 0, marginTop: 1 }}
                />
                <span>
                  <strong>{t("invoices.aiDraftNotesLabel")}</strong> {aiNotes}
                </span>
              </div>
            )}

            {hasConfidence && (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  fontSize: 11,
                  color: "var(--text-muted)",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <span>{t("invoices.aiDraftConfidenceLabel")}</span>
                {["high", "medium", "low"].map((c) => (
                  <span
                    key={c}
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: CONFIDENCE_COLORS[c],
                      }}
                    />
                    {t(`invoices.confidence_${c}`)}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((it, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "12px 1fr 64px 90px 90px 30px",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <span
                    title={
                      it.confidence
                        ? t(`invoices.confidence_${it.confidence}`)
                        : undefined
                    }
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: it.confidence
                        ? CONFIDENCE_COLORS[it.confidence]
                        : "transparent",
                    }}
                  />
                  <input
                    className="input"
                    placeholder={t("invoices.itemDescription")}
                    value={it.description}
                    onChange={(e) =>
                      updateItem(i, "description", e.target.value)
                    }
                  />
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("invoices.qty")}
                    value={it.quantity}
                    onChange={(e) => updateItem(i, "quantity", e.target.value)}
                    style={{ textAlign: "right" }}
                  />
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("invoices.unitPrice")}
                    value={it.unit_price}
                    onChange={(e) => updateItem(i, "unit_price", e.target.value)}
                    style={{ textAlign: "right" }}
                  />
                  <div
                    style={{
                      fontSize: 12,
                      textAlign: "right",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {fmt(
                      (parseFloat(it.quantity) || 0) *
                        (parseFloat(it.unit_price) || 0),
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => removeItem(i)}
                    style={{ padding: "4px 6px" }}
                    title={t("common.delete")}
                  >
                    <i className="ti ti-x" style={{ fontSize: 12 }} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={addItem}
              style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}
            >
              <i className="ti ti-plus" style={{ fontSize: 13 }} />
              {t("invoices.addLineItem")}
            </button>
          </div>

          {/* Tax + revenue account */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8 }}>
            <div>
              <label className="label">{t("invoices.taxType")}</label>
              <select
                className="input"
                value={form.taxType}
                onChange={(e) => setTaxType(e.target.value)}
                disabled={taxExempt}
              >
                <option value="generic">{t("invoices.taxGeneric")}</option>
                <option value="ivu">{t("invoices.taxIvu")}</option>
              </select>
            </div>
            <div>
              <label className="label">{t("invoices.taxRate")}</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.001"
                value={form.taxRate}
                onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                disabled={taxExempt}
                style={{ textAlign: "right" }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8 }}>
            <div>
              <label className="label">{t("invoices.revenueAccount")}</label>
              <select
                className="input"
                value={form.incomeAccountId}
                onChange={(e) =>
                  setForm({ ...form, incomeAccountId: e.target.value })
                }
              >
                <option value="">{t("invoices.defaultRevenue")}</option>
                {revenueAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {coaName(a, t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("invoices.language")}</label>
              <select
                className="input"
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
              >
                <option value="en">EN</option>
                <option value="es">ES</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">{t("invoices.notes")}</label>
            <input
              className="input"
              type="text"
              placeholder={t("invoices.notesPlaceholder")}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {/* Totals */}
          <div
            style={{
              background: "var(--bg-secondary)",
              borderRadius: 8,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>
                {t("invoices.subtotal")}
              </span>
              <span style={{ color: "var(--text-primary)" }}>{fmt(subtotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>
                {form.taxType === "ivu"
                  ? t("invoices.ivuLine", { rate: effectiveRate })
                  : t("invoices.taxLine", { rate: effectiveRate })}
              </span>
              <span style={{ color: "var(--text-primary)" }}>{fmt(taxTotal)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 700,
                fontSize: 15,
                borderTop: "0.5px solid var(--border-color)",
                paddingTop: 6,
                marginTop: 2,
              }}
            >
              <span style={{ color: "var(--text-primary)" }}>
                {t("invoices.total")}
              </span>
              <span style={{ color: "var(--brand)" }}>{fmt(total)}</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending
                ? t("invoices.saving")
                : isEdit
                  ? t("invoices.saveChanges")
                  : t("invoices.createInvoice")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Record-payment modal ──────────────────────────────────────
function PayModal({ invoice, accounts, onClose, onPaid, t, fmt }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [paidDate, setPaidDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [error, setError] = useState("");

  // From a draft, issue + pay in one atomic call; otherwise just record payment.
  const isDraft = invoice.status === "draft";

  const payMutation = useMutation({
    mutationFn: () =>
      isDraft
        ? api
            .post(`/invoices/${invoice.id}/send`, {
              markPaid: true,
              accountId,
              paidDate,
            })
            .then((r) => r.data)
        : api
            .post(`/invoices/${invoice.id}/pay`, { accountId, paidDate })
            .then((r) => r.data),
    onSuccess: onPaid,
    onError: (err) =>
      setError(err.response?.data?.error || t("invoices.payFailed")),
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card fade-in" style={{ width: "100%", maxWidth: 380, padding: 24 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 700,
            margin: "0 0 4px",
            color: "var(--text-primary)",
          }}
        >
          {t("invoices.recordPayment")}
        </h2>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          {invoice.invoice_number} · {fmt(invoice.total)}
        </div>

        {isDraft && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              background: "var(--bg-secondary)",
              borderRadius: 6,
              padding: "8px 12px",
              marginBottom: 14,
            }}
          >
            {t("invoices.markPaidDraftHint")}
          </div>
        )}

        {error && (
          <div
            style={{
              fontSize: 13,
              color: "var(--expense)",
              background: "var(--expense-bg)",
              borderRadius: 6,
              padding: "8px 12px",
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="label">{t("invoices.depositTo")}</label>
            <select
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.length === 0 && (
                <option value="">{t("invoices.noDepositAccounts")}</option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("invoices.paymentDate")}</label>
            <input
              className="input"
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-primary"
              disabled={!accountId || payMutation.isPending}
              onClick={() => payMutation.mutate()}
            >
              {payMutation.isPending
                ? t("invoices.saving")
                : t("invoices.markPaid")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Invoice detail drawer ─────────────────────────────────────
function InvoiceDrawer({ invoiceId, accounts, onClose, onEdit, businessName, fmt, t }) {
  const qc = useQueryClient();
  const [showPay, setShowPay] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => api.get(`/invoices/${invoiceId}`).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  const [emailMsg, setEmailMsg] = useState(null);
  // Surface the email outcome returned by send/resend (delivered, dev-capture
  // fallback, or an error) as a transient message.
  function showEmailResult(email) {
    if (!email) return;
    if (email.delivered) {
      setEmailMsg({
        ok: true,
        text: email.fallback
          ? t("invoices.emailCaptured")
          : t("invoices.emailSent", { email: invoice?.billing_email || "" }),
      });
    } else {
      setEmailMsg({ ok: false, text: email.error || t("invoices.emailFailed") });
    }
    setTimeout(() => setEmailMsg(null), 6000);
  }

  const sendMutation = useMutation({
    mutationFn: () => api.post(`/invoices/${invoiceId}/send`).then((r) => r.data),
    onSuccess: (data) => {
      invalidate();
      showEmailResult(data.email);
    },
    onError: (err) =>
      window.alert(err.response?.data?.error || t("invoices.sendFailed")),
  });
  const resendMutation = useMutation({
    mutationFn: () =>
      api.post(`/invoices/${invoiceId}/resend`).then((r) => r.data),
    onSuccess: (data) => {
      invalidate();
      showEmailResult(data.email);
    },
    onError: (err) =>
      window.alert(err.response?.data?.error || t("invoices.resendFailed")),
  });
  const downloadPdf = useMutation({
    mutationFn: async () => {
      const res = await api.get(`/invoices/${invoiceId}/pdf`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice?.invoice_number || "invoice"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
  const voidMutation = useMutation({
    mutationFn: () => api.post(`/invoices/${invoiceId}/void`).then((r) => r.data),
    onSuccess: invalidate,
    onError: (err) =>
      window.alert(err.response?.data?.error || t("invoices.voidFailed")),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/invoices/${invoiceId}`).then((r) => r.data),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) =>
      window.alert(err.response?.data?.error || t("invoices.deleteFailed")),
  });

  const eff = invoice?.is_overdue ? "overdue" : invoice?.status;
  const c = STATUS_COLORS[eff] || STATUS_COLORS.draft;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 200,
        }}
      />
      <div
        className="fade-in"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 440,
          maxWidth: "100vw",
          background: "var(--bg-primary)",
          borderLeft: "0.5px solid var(--border-color)",
          zIndex: 201,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "0.5px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}
            >
              {invoice?.invoice_number || "…"}
            </div>
            {invoice && (
              <span
                style={{
                  display: "inline-block",
                  marginTop: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: c.bg,
                  color: c.fg,
                  letterSpacing: 0.5,
                }}
              >
                {t(`invoices.status.${eff}`)}
              </span>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {isLoading || !invoice ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("common.loading")}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}
                >
                  {invoice.client_name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {t("invoices.issued", {
                    date: dayjs(invoice.issue_date).format("MMM D, YYYY"),
                  })}{" "}
                  ·{" "}
                  {t("invoices.due", {
                    date: dayjs(invoice.due_date).format("MMM D, YYYY"),
                  })}
                </div>
              </div>

              {/* Line items */}
              <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
                {invoice.line_items.map((li) => (
                  <div
                    key={li.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderBottom: "0.5px solid var(--border-color)",
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
                        {li.description}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {Number(li.quantity)} × {fmt(li.unit_price)}
                      </div>
                    </div>
                    <div
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}
                    >
                      {fmt(li.total)}
                    </div>
                  </div>
                ))}
                <div style={{ padding: "10px 14px" }}>
                  <Row label={t("invoices.subtotal")} value={fmt(invoice.subtotal)} />
                  {Number(invoice.tax_total) > 0 && (
                    <Row
                      label={
                        invoice.tax_type === "ivu"
                          ? t("invoices.ivuLine", { rate: Number(invoice.tax_rate) })
                          : t("invoices.taxLine", { rate: Number(invoice.tax_rate) })
                      }
                      value={fmt(invoice.tax_total)}
                    />
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      fontSize: 15,
                      borderTop: "0.5px solid var(--border-color)",
                      paddingTop: 6,
                      marginTop: 4,
                    }}
                  >
                    <span style={{ color: "var(--text-primary)" }}>
                      {t("invoices.total")}
                    </span>
                    <span style={{ color: "var(--brand)" }}>{fmt(invoice.total)}</span>
                  </div>
                </div>
              </div>

              {invoice.notes && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
                  {invoice.notes}
                </div>
              )}

              {emailMsg && (
                <div
                  style={{
                    fontSize: 12,
                    padding: "8px 12px",
                    borderRadius: 8,
                    marginBottom: 10,
                    background: emailMsg.ok
                      ? "var(--income-bg)"
                      : "var(--expense-bg)",
                    color: emailMsg.ok ? "var(--income)" : "var(--expense)",
                  }}
                >
                  <i
                    className={`ti ${emailMsg.ok ? "ti-mail-check" : "ti-alert-circle"}`}
                    style={{ marginRight: 6 }}
                  />
                  {emailMsg.text}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => downloadPdf.mutate()}
                  disabled={downloadPdf.isPending}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    justifyContent: "center",
                  }}
                >
                  <i className="ti ti-download" style={{ fontSize: 14 }} />
                  {t("invoices.downloadPdf")}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => openPrintWindow(invoice, businessName)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    justifyContent: "center",
                  }}
                >
                  <i className="ti ti-printer" style={{ fontSize: 14 }} />
                  {t("invoices.printPdf")}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Action footer — depends on status */}
        {invoice && invoice.status !== "void" && (
          <div
            style={{
              padding: "12px 20px",
              borderTop: "0.5px solid var(--border-color)",
              flexShrink: 0,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {invoice.status === "draft" && (
              <>
                <div style={{ display: "flex", gap: 8, width: "100%" }}>
                  <button
                    className="btn btn-secondary"
                    onClick={onEdit}
                    style={{ flex: 1 }}
                  >
                    <i className="ti ti-pencil" style={{ fontSize: 14, marginRight: 6 }} />
                    {t("common.edit")}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      if (window.confirm(t("invoices.confirmDelete")))
                        deleteMutation.mutate();
                    }}
                    style={{ color: "var(--expense)" }}
                    title={t("common.delete")}
                  >
                    <i className="ti ti-trash" style={{ fontSize: 14 }} />
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, width: "100%" }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowPay(true)}
                    disabled={accounts.length === 0}
                    title={
                      accounts.length === 0
                        ? t("invoices.noDepositAccounts")
                        : undefined
                    }
                    style={{ flex: 1 }}
                  >
                    <i className="ti ti-cash" style={{ fontSize: 14, marginRight: 6 }} />
                    {t("invoices.markPaid")}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => sendMutation.mutate()}
                    disabled={sendMutation.isPending}
                    style={{ flex: 1 }}
                  >
                    <i className="ti ti-send" style={{ fontSize: 14, marginRight: 6 }} />
                    {t("invoices.send")}
                  </button>
                </div>
              </>
            )}
            {(invoice.status === "sent" || invoice.status === "overdue") && (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={() => resendMutation.mutate()}
                  disabled={resendMutation.isPending}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    justifyContent: "center",
                  }}
                >
                  <i className="ti ti-send" style={{ fontSize: 14 }} />
                  {resendMutation.isPending
                    ? t("invoices.sending")
                    : t("invoices.resend")}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (window.confirm(t("invoices.confirmVoid")))
                      voidMutation.mutate();
                  }}
                  style={{ flex: 1, color: "var(--expense)" }}
                >
                  {t("invoices.void")}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowPay(true)}
                  style={{ flex: 1 }}
                >
                  <i className="ti ti-cash" style={{ fontSize: 14, marginRight: 6 }} />
                  {t("invoices.recordPayment")}
                </button>
              </>
            )}
            {invoice.status === "paid" && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (window.confirm(t("invoices.confirmVoid")))
                    voidMutation.mutate();
                }}
                style={{ width: "100%", color: "var(--expense)" }}
              >
                {t("invoices.void")}
              </button>
            )}
          </div>
        )}
      </div>

      {showPay && invoice && (
        <PayModal
          invoice={invoice}
          accounts={accounts}
          onClose={() => setShowPay(false)}
          onPaid={() => {
            setShowPay(false);
            invalidate();
          }}
          t={t}
          fmt={fmt}
        />
      )}
    </>
  );
}

function Row({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 13,
        color: "var(--text-muted)",
        marginBottom: 2,
      }}
    >
      <span>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Invoices() {
  const { t, i18n } = useTranslation();
  const fmt = makeFmt(i18n.language);
  const business = useAuthStore((s) => s.business);

  const [searchParams, setSearchParams] = useSearchParams();
  const clientFilter = searchParams.get("client") || "";
  const invoiceParam = searchParams.get("invoice") || "";

  const [statusTab, setStatusTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);

  // Mutate the query string without stacking history entries.
  const updateParams = (mutate) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  };

  // Deep link: /invoices?invoice=<id> opens that invoice's drawer. State is
  // synced during render (guarded by a change check) rather than in an effect,
  // per https://react.dev/learn/you-might-not-need-an-effect.
  const [appliedInvoiceParam, setAppliedInvoiceParam] = useState(null);
  if (invoiceParam !== appliedInvoiceParam) {
    setAppliedInvoiceParam(invoiceParam);
    if (invoiceParam) setSelectedId(invoiceParam);
  }

  const { data: invoices = [], isLoading } = useQuery({
    // clientFilter (from /invoices?client=<id>) scopes the list to one client.
    queryKey: ["invoices", statusTab, clientFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusTab !== "all") p.set("status", statusTab);
      if (clientFilter) p.set("clientId", clientFilter);
      return api.get(`/invoices?${p}`).then((r) => r.data);
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients", "", "active"],
    queryFn: () => api.get("/clients?active=true").then((r) => r.data),
  });

  const { data: coa = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });

  const { data: accountsList = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });

  const revenueAccounts = useMemo(() => accountsOfType(coa, "revenue"), [coa]);
  const depositAccounts = useMemo(
    () => accountsList.filter((a) => a.is_active && a.coa_account_id),
    [accountsList],
  );

  // Summary across the full (unfiltered) outstanding set — fetched separately
  // so the header is stable regardless of the active tab.
  const { data: outstanding = [] } = useQuery({
    queryKey: ["invoices", "outstanding"],
    queryFn: () =>
      api.get("/invoices?status=outstanding").then((r) => r.data),
  });
  const totalOutstanding = outstanding.reduce(
    (s, i) => s + parseFloat(i.total),
    0,
  );
  const overdueCount = outstanding.filter((i) => i.is_overdue).length;

  function openEdit(invoice) {
    setEditInvoice(invoice);
    setShowBuilder(true);
    setSelectedId(null);
  }
  function closeBuilder() {
    setShowBuilder(false);
    setEditInvoice(null);
  }
  function closeDrawer() {
    setSelectedId(null);
    if (invoiceParam) updateParams((p) => p.delete("invoice"));
  }

  // Name for the active client filter chip (clients list is active-only;
  // fall back to a generic label for an inactive/unknown client).
  const filteredClientName =
    clients.find((c) => c.id === clientFilter)?.name || t("invoices.thisClient");

  const TABS = [
    { key: "all", label: t("invoices.tabAll") },
    { key: "draft", label: t("invoices.status.draft") },
    { key: "outstanding", label: t("invoices.tabOutstanding") },
    { key: "paid", label: t("invoices.status.paid") },
  ];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            {t("invoices.title")}
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
            {t("invoices.subtitle")}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditInvoice(null);
            setShowBuilder(true);
          }}
          disabled={clients.length === 0}
          title={clients.length === 0 ? t("invoices.needClient") : undefined}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <i className="ti ti-plus" style={{ fontSize: 15 }} />
          {t("invoices.newInvoice")}
        </button>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            {t("invoices.totalOutstanding")}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--brand)" }}>
            {fmt(totalOutstanding)}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            {t("invoices.overdueCount")}
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: overdueCount > 0 ? "var(--expense)" : "var(--text-primary)",
            }}
          >
            {overdueCount}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            {t("invoices.openInvoices")}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
            {outstanding.length}
          </div>
        </div>
      </div>

      {/* Status tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((tb) => (
          <button
            key={tb.key}
            className={`btn btn-sm ${statusTab === tb.key ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setStatusTab(tb.key)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Active client filter (from a deep link) */}
      {clientFilter && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            padding: "6px 8px 6px 12px",
            borderRadius: 16,
            background: "var(--brand-light)",
            color: "var(--brand)",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <i className="ti ti-filter" style={{ fontSize: 14 }} />
          <span>{t("invoices.filteredByClient", { name: filteredClientName })}</span>
          <button
            onClick={() => updateParams((p) => p.delete("client"))}
            aria-label={t("invoices.clearFilter")}
            style={{
              display: "flex",
              alignItems: "center",
              border: "none",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              padding: 2,
            }}
          >
            <i className="ti ti-x" style={{ fontSize: 14 }} />
          </button>
        </div>
      )}

      {isLoading && (
        <div
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            padding: "40px 0",
            textAlign: "center",
          }}
        >
          {t("common.loading")}
        </div>
      )}

      {!isLoading && invoices.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <i
            className="ti ti-file-invoice"
            style={{
              fontSize: 40,
              color: "var(--text-muted)",
              display: "block",
              marginBottom: 12,
            }}
          />
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 6,
            }}
          >
            {t("invoices.noneYet")}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {clients.length === 0
              ? t("invoices.needClient")
              : t("invoices.noneYetHint")}
          </div>
        </div>
      )}

      {!isLoading && invoices.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 120px 120px 110px",
              padding: "10px 16px",
              borderBottom: "0.5px solid var(--border-color)",
              background: "var(--bg-secondary)",
              fontSize: 11,
              color: "var(--text-muted)",
              fontWeight: 500,
              letterSpacing: 0.5,
            }}
          >
            <div>{t("invoices.colNumber")}</div>
            <div>{t("invoices.colClient")}</div>
            <div>{t("invoices.colDue")}</div>
            <div style={{ textAlign: "right" }}>{t("invoices.colTotal")}</div>
            <div style={{ textAlign: "right" }}>{t("common.status")}</div>
          </div>

          {invoices.map((inv) => {
            const eff = inv.is_overdue ? "overdue" : inv.status;
            const c = STATUS_COLORS[eff] || STATUS_COLORS.draft;
            return (
              <div
                key={inv.id}
                onClick={() => setSelectedId(inv.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 1fr 120px 120px 110px",
                  padding: "12px 16px",
                  borderBottom: "0.5px solid var(--border-color)",
                  alignItems: "center",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bg-secondary)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}
                >
                  {inv.invoice_number}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {inv.client_name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {dayjs(inv.due_date).format("MMM D, YYYY")}
                  {inv.is_overdue && (
                    <span style={{ color: "var(--expense)", marginLeft: 4 }}>
                      ({t("invoices.daysLate", { days: inv.days_overdue })})
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    textAlign: "right",
                  }}
                >
                  {fmt(inv.total)}
                </div>
                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 4,
                      background: c.bg,
                      color: c.fg,
                      letterSpacing: 0.5,
                    }}
                  >
                    {t(`invoices.status.${eff}`)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedId && (
        <InvoiceDrawer
          invoiceId={selectedId}
          accounts={depositAccounts}
          businessName={business?.name}
          onClose={closeDrawer}
          onEdit={() => {
            // Need the full invoice (with line items) for editing — fetch fresh.
            api.get(`/invoices/${selectedId}`).then((r) => openEdit(r.data));
          }}
          fmt={fmt}
          t={t}
        />
      )}

      {showBuilder && (
        <InvoiceModal
          invoice={editInvoice}
          clients={clients}
          revenueAccounts={revenueAccounts}
          onClose={closeBuilder}
          t={t}
          lang={i18n.language}
        />
      )}
    </div>
  );
}
