import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import dayjs from "dayjs";
import cx from "../lib/cx";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";

const IVU_DEFAULT_RATE = 11.5;

const makeFmt = (lang) => (val) =>
  new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(val || 0);

const coaName = (a, t) => (a.name_key ? t(a.name_key) : a.name);

const STATUS_TONES = {
  draft: "neutral",
  sent: "brand",
  overdue: "expense",
  paid: "income",
  void: "neutral",
};

function StatusBadge({ status, t }) {
  return (
    <Badge tone={STATUS_TONES[status] || "neutral"}>
      {t(`invoices.status.${status}`)}
    </Badge>
  );
}

// Confidence indicator for AI-drafted line items (#12).
const CONFIDENCE_COLORS = {
  high: "var(--income)",
  medium: "#b88a1f",
  low: "var(--expense)",
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
  const d = (v) => (dayjs(v).locale ? dayjs(v).format("YYYY-MM-DD") : v);

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
    setItems((arr) =>
      arr.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)),
    );
  }
  function addItem() {
    setItems((arr) => [
      ...arr,
      { description: "", quantity: "1", unit_price: "" },
    ]);
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
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? t("invoices.editInvoice") : t("invoices.newInvoice")}
    >
      {error && (
        <div className="text-md text-expense bg-expense-bg rounded-md px-3 py-2 mb-3.5">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {!isEdit && (
          <div className="bg-canvas rounded-lg p-3 flex flex-col gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-secondary">
              <i className="ti ti-sparkles text-brand" />
              {t("invoices.aiDraftTitle")}
            </label>
            <Textarea
              rows={2}
              className="min-h-[46px]"
              placeholder={t("invoices.aiDraftPlaceholder")}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
            {aiError && <div className="text-xs text-expense">{aiError}</div>}
            <Button
              size="sm"
              icon="ti-sparkles"
              onClick={handleAiDraft}
              disabled={aiDraft.isPending}
              className="self-start"
            >
              {aiDraft.isPending
                ? t("invoices.aiDraftGenerating")
                : t("invoices.aiDraftGenerate")}
            </Button>
          </div>
        )}

        <Field label={t("invoices.clientLabel")} className="mb-0">
          <Select value={form.clientId} onChange={(e) => setClient(e.target.value)}>
            <option value="">{t("invoices.selectClient")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {taxExempt && (
            <div className="text-[11px] text-income mt-1">
              {t("invoices.clientTaxExempt")}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t("invoices.issueDate")} className="mb-0">
            <Input
              type="date"
              value={form.issueDate}
              onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
            />
          </Field>
          <Field label={t("invoices.dueDate")} className="mb-0">
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </Field>
        </div>

        {/* Line items */}
        <div>
          <div className="text-xs font-medium text-secondary mb-1">
            {t("invoices.lineItems")}
          </div>

          {aiNotes && (
            <div className="flex gap-1.5 text-xs text-secondary bg-brand-light rounded-md px-3 py-2 mb-2">
              <i
                className="ti ti-info-circle text-brand shrink-0 mt-px"
                aria-hidden="true"
              />
              <span>
                <strong>{t("invoices.aiDraftNotesLabel")}</strong> {aiNotes}
              </span>
            </div>
          )}

          {hasConfidence && (
            <div className="flex items-center gap-3 text-[11px] text-muted mb-2">
              <span>{t("invoices.aiDraftConfidenceLabel")}</span>
              {["high", "medium", "low"].map((c) => (
                <span key={c} className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: CONFIDENCE_COLORS[c] }}
                  />
                  {t(`invoices.confidence_${c}`)}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {items.map((it, i) => (
              <div
                key={i}
                className="grid grid-cols-[12px_minmax(0,1fr)_52px_76px_28px] sm:grid-cols-[12px_1fr_64px_90px_90px_30px] gap-1.5 items-center"
              >
                <span
                  title={
                    it.confidence
                      ? t(`invoices.confidence_${it.confidence}`)
                      : undefined
                  }
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: it.confidence
                      ? CONFIDENCE_COLORS[it.confidence]
                      : "transparent",
                  }}
                />
                <Input
                  placeholder={t("invoices.itemDescription")}
                  value={it.description}
                  onChange={(e) => updateItem(i, "description", e.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("invoices.qty")}
                  value={it.quantity}
                  onChange={(e) => updateItem(i, "quantity", e.target.value)}
                  className="text-right"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("invoices.unitPrice")}
                  value={it.unit_price}
                  onChange={(e) => updateItem(i, "unit_price", e.target.value)}
                  className="text-right"
                />
                <div className="hidden sm:block text-xs text-right text-secondary">
                  {fmt(
                    (parseFloat(it.quantity) || 0) *
                      (parseFloat(it.unit_price) || 0),
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="flex items-center justify-center w-[26px] h-[26px] rounded-md text-muted hover:text-danger hover:bg-danger-bg cursor-pointer"
                  title={t("common.delete")}
                >
                  <i className="ti ti-x text-xs" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" icon="ti-plus" onClick={addItem} className="mt-2">
            {t("invoices.addLineItem")}
          </Button>
        </div>

        {/* Tax + revenue account */}
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <Field label={t("invoices.taxType")} className="mb-0">
            <Select
              value={form.taxType}
              onChange={(e) => setTaxType(e.target.value)}
              disabled={taxExempt}
            >
              <option value="generic">{t("invoices.taxGeneric")}</option>
              <option value="ivu">{t("invoices.taxIvu")}</option>
            </Select>
          </Field>
          <Field label={t("invoices.taxRate")} className="mb-0">
            <Input
              type="number"
              min="0"
              step="0.001"
              value={form.taxRate}
              onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
              disabled={taxExempt}
              className="text-right"
            />
          </Field>
        </div>

        <div className="grid grid-cols-[1fr_110px] gap-2">
          <Field label={t("invoices.revenueAccount")} className="mb-0">
            <Select
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
            </Select>
          </Field>
          <Field label={t("invoices.language")} className="mb-0">
            <Select
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </Select>
          </Field>
        </div>

        <Field label={t("invoices.notes")} className="mb-0">
          <Input
            type="text"
            placeholder={t("invoices.notesPlaceholder")}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        {/* Totals */}
        <div className="bg-canvas rounded-lg px-3.5 py-3 flex flex-col gap-1 text-md">
          <div className="flex justify-between">
            <span className="text-muted">{t("invoices.subtotal")}</span>
            <span className="text-ink">{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">
              {form.taxType === "ivu"
                ? t("invoices.ivuLine", { rate: effectiveRate })
                : t("invoices.taxLine", { rate: effectiveRate })}
            </span>
            <span className="text-ink">{fmt(taxTotal)}</span>
          </div>
          <div className="flex justify-between font-bold text-[15px] border-t border-line pt-1.5 mt-0.5">
            <span className="text-ink">{t("invoices.total")}</span>
            <span className="text-brand">{fmt(total)}</span>
          </div>
        </div>

        <div className="flex gap-2.5 justify-end mt-1">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending
              ? t("invoices.saving")
              : isEdit
                ? t("invoices.saveChanges")
                : t("invoices.createInvoice")}
          </Button>
        </div>
      </form>
    </Modal>
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
    <Modal open onClose={onClose} size="sm" title={t("invoices.recordPayment")}>
      <div className="text-md text-muted mb-4 -mt-1">
        {invoice.invoice_number} · {fmt(invoice.total)}
      </div>

      {isDraft && (
        <div className="text-xs text-secondary bg-canvas rounded-md px-3 py-2 mb-3.5">
          {t("invoices.markPaidDraftHint")}
        </div>
      )}

      {error && (
        <div className="text-md text-expense bg-expense-bg rounded-md px-3 py-2 mb-3.5">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3.5">
        <Field label={t("invoices.depositTo")} className="mb-0">
          <Select
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
          </Select>
        </Field>
        <Field label={t("invoices.paymentDate")} className="mb-0">
          <Input
            type="date"
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
          />
        </Field>
        <div className="flex gap-2.5 justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!accountId || payMutation.isPending}
            onClick={() => payMutation.mutate()}
          >
            {payMutation.isPending
              ? t("invoices.saving")
              : t("invoices.markPaid")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Invoice detail drawer ─────────────────────────────────────
function InvoiceDrawer({
  invoiceId,
  accounts,
  onClose,
  onEdit,
  businessName,
  fmt,
  t,
}) {
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

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 z-[150]" />
      <div className="fade-in fixed top-0 right-0 bottom-0 w-[440px] max-w-full bg-surface border-l border-line z-[151] flex flex-col overflow-hidden">
        <div className="flex justify-between items-start gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0">
            <div className="text-base font-bold text-ink">
              {invoice?.invoice_number || "…"}
            </div>
            {invoice && (
              <div className="mt-1">
                <StatusBadge status={eff} t={t} />
              </div>
            )}
          </div>
          <Button size="sm" icon="ti-x" onClick={onClose} aria-label="Close" />
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {isLoading || !invoice ? (
            <div className="text-md text-muted">{t("common.loading")}</div>
          ) : (
            <>
              <div className="mb-4">
                <div className="text-sm font-semibold text-ink">
                  {invoice.client_name}
                </div>
                <div className="text-xs text-muted mt-0.5">
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
              <Card padding="none" className="overflow-hidden mb-4">
                {invoice.line_items.map((li) => (
                  <div
                    key={li.id}
                    className="flex justify-between gap-2 px-3.5 py-2.5 border-b border-line"
                  >
                    <div className="min-w-0">
                      <div className="text-md text-ink">{li.description}</div>
                      <div className="text-[11px] text-muted">
                        {Number(li.quantity)} × {fmt(li.unit_price)}
                      </div>
                    </div>
                    <div className="text-md font-semibold text-ink">
                      {fmt(li.total)}
                    </div>
                  </div>
                ))}
                <div className="px-3.5 py-2.5">
                  <Row label={t("invoices.subtotal")} value={fmt(invoice.subtotal)} />
                  {Number(invoice.tax_total) > 0 && (
                    <Row
                      label={
                        invoice.tax_type === "ivu"
                          ? t("invoices.ivuLine", {
                              rate: Number(invoice.tax_rate),
                            })
                          : t("invoices.taxLine", {
                              rate: Number(invoice.tax_rate),
                            })
                      }
                      value={fmt(invoice.tax_total)}
                    />
                  )}
                  <div className="flex justify-between font-bold text-[15px] border-t border-line pt-1.5 mt-1">
                    <span className="text-ink">{t("invoices.total")}</span>
                    <span className="text-brand">{fmt(invoice.total)}</span>
                  </div>
                </div>
              </Card>

              {invoice.notes && (
                <div className="text-xs text-secondary mb-4">{invoice.notes}</div>
              )}

              {emailMsg && (
                <div
                  className={cx(
                    "text-xs px-3 py-2 rounded-lg mb-2.5",
                    emailMsg.ok
                      ? "bg-income-bg text-income"
                      : "bg-expense-bg text-expense",
                  )}
                >
                  <i
                    className={`ti ${emailMsg.ok ? "ti-mail-check" : "ti-alert-circle"} mr-1.5`}
                    aria-hidden="true"
                  />
                  {emailMsg.text}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  icon="ti-download"
                  onClick={() => downloadPdf.mutate()}
                  disabled={downloadPdf.isPending}
                  className="flex-1 justify-center"
                >
                  {t("invoices.downloadPdf")}
                </Button>
                <Button
                  icon="ti-printer"
                  onClick={() => openPrintWindow(invoice, businessName)}
                  className="flex-1 justify-center"
                >
                  {t("invoices.printPdf")}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Action footer — depends on status */}
        {invoice && invoice.status !== "void" && (
          <div className="flex gap-2 flex-wrap px-5 py-3 border-t border-line shrink-0">
            {invoice.status === "draft" && (
              <>
                <div className="flex gap-2 w-full">
                  <Button
                    icon="ti-pencil"
                    onClick={onEdit}
                    className="flex-1 justify-center"
                  >
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="danger"
                    icon="ti-trash"
                    title={t("common.delete")}
                    onClick={() => {
                      if (window.confirm(t("invoices.confirmDelete")))
                        deleteMutation.mutate();
                    }}
                  />
                </div>
                <div className="flex gap-2 w-full">
                  <Button
                    icon="ti-cash"
                    onClick={() => setShowPay(true)}
                    disabled={accounts.length === 0}
                    title={
                      accounts.length === 0
                        ? t("invoices.noDepositAccounts")
                        : undefined
                    }
                    className="flex-1 justify-center"
                  >
                    {t("invoices.markPaid")}
                  </Button>
                  <Button
                    variant="primary"
                    icon="ti-send"
                    onClick={() => sendMutation.mutate()}
                    disabled={sendMutation.isPending}
                    className="flex-1 justify-center"
                  >
                    {t("invoices.send")}
                  </Button>
                </div>
              </>
            )}
            {(invoice.status === "sent" || invoice.status === "overdue") && (
              <>
                <Button
                  icon="ti-send"
                  onClick={() => resendMutation.mutate()}
                  disabled={resendMutation.isPending}
                  full
                >
                  {resendMutation.isPending
                    ? t("invoices.sending")
                    : t("invoices.resend")}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(t("invoices.confirmVoid")))
                      voidMutation.mutate();
                  }}
                  className="flex-1 justify-center"
                >
                  {t("invoices.void")}
                </Button>
                <Button
                  variant="primary"
                  icon="ti-cash"
                  onClick={() => setShowPay(true)}
                  className="flex-1 justify-center"
                >
                  {t("invoices.recordPayment")}
                </Button>
              </>
            )}
            {invoice.status === "paid" && (
              <Button
                variant="danger"
                full
                onClick={() => {
                  if (window.confirm(t("invoices.confirmVoid")))
                    voidMutation.mutate();
                }}
              >
                {t("invoices.void")}
              </Button>
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
    <div className="flex justify-between text-md text-muted mb-0.5">
      <span>{label}</span>
      <span className="text-ink">{value}</span>
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
    queryFn: () => api.get("/invoices?status=outstanding").then((r) => r.data),
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
    <div className="max-w-[960px] mx-auto">
      <PageHeader
        title={t("invoices.title")}
        subtitle={t("invoices.subtitle")}
        actions={
          <Button
            variant="primary"
            icon="ti-plus"
            onClick={() => {
              setEditInvoice(null);
              setShowBuilder(true);
            }}
            disabled={clients.length === 0}
            title={clients.length === 0 ? t("invoices.needClient") : undefined}
          >
            {t("invoices.newInvoice")}
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-5">
        <Card padding="none" className="px-4 py-3.5">
          <div className="text-[11px] text-muted mb-1">
            {t("invoices.totalOutstanding")}
          </div>
          <div className="text-xl font-bold text-brand">
            {fmt(totalOutstanding)}
          </div>
        </Card>
        <Card padding="none" className="px-4 py-3.5">
          <div className="text-[11px] text-muted mb-1">
            {t("invoices.overdueCount")}
          </div>
          <div
            className={cx(
              "text-xl font-bold",
              overdueCount > 0 ? "text-expense" : "text-ink",
            )}
          >
            {overdueCount}
          </div>
        </Card>
        <Card padding="none" className="px-4 py-3.5">
          <div className="text-[11px] text-muted mb-1">
            {t("invoices.openInvoices")}
          </div>
          <div className="text-xl font-bold text-ink">{outstanding.length}</div>
        </Card>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {TABS.map((tb) => (
          <Button
            key={tb.key}
            size="sm"
            variant={statusTab === tb.key ? "primary" : "secondary"}
            onClick={() => setStatusTab(tb.key)}
          >
            {tb.label}
          </Button>
        ))}
      </div>

      {/* Active client filter (from a deep link) */}
      {clientFilter && (
        <div className="inline-flex items-center gap-2 mb-4 py-1.5 pl-3 pr-2 rounded-2xl bg-brand-light text-brand text-xs font-medium">
          <i className="ti ti-filter text-sm" aria-hidden="true" />
          <span>
            {t("invoices.filteredByClient", { name: filteredClientName })}
          </span>
          <button
            onClick={() => updateParams((p) => p.delete("client"))}
            aria-label={t("invoices.clearFilter")}
            className="flex items-center text-inherit cursor-pointer p-0.5"
          >
            <i className="ti ti-x text-sm" aria-hidden="true" />
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-muted py-10 text-center">
          {t("common.loading")}
        </div>
      )}

      {!isLoading && invoices.length === 0 && (
        <Card>
          <EmptyState
            icon="ti-file-invoice"
            title={t("invoices.noneYet")}
            message={
              clients.length === 0
                ? t("invoices.needClient")
                : t("invoices.noneYetHint")
            }
          />
        </Card>
      )}

      {!isLoading && invoices.length > 0 && (
        <Card padding="none" className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="grid grid-cols-[120px_1fr_120px_120px_110px] px-4 py-2.5 border-b border-line bg-canvas text-[11px] text-muted font-medium tracking-[0.5px]">
              <div>{t("invoices.colNumber")}</div>
              <div>{t("invoices.colClient")}</div>
              <div>{t("invoices.colDue")}</div>
              <div className="text-right">{t("invoices.colTotal")}</div>
              <div className="text-right">{t("common.status")}</div>
            </div>

            {invoices.map((inv) => {
              const eff = inv.is_overdue ? "overdue" : inv.status;
              return (
                <div
                  key={inv.id}
                  onClick={() => setSelectedId(inv.id)}
                  className="grid grid-cols-[120px_1fr_120px_120px_110px] px-4 py-3 border-b border-line items-center cursor-pointer transition-colors hover:bg-canvas"
                >
                  <div className="text-md font-semibold text-ink">
                    {inv.invoice_number}
                  </div>
                  <div className="text-md text-secondary truncate">
                    {inv.client_name}
                  </div>
                  <div className="text-xs text-muted">
                    {dayjs(inv.due_date).format("MMM D, YYYY")}
                    {inv.is_overdue && (
                      <span className="text-expense ml-1">
                        ({t("invoices.daysLate", { days: inv.days_overdue })})
                      </span>
                    )}
                  </div>
                  <div className="text-md font-semibold text-ink text-right">
                    {fmt(inv.total)}
                  </div>
                  <div className="text-right">
                    <StatusBadge status={eff} t={t} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
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
