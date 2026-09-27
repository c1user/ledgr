// Review & book helpers (ROADMAP-V6 2.7). Everything here is framework-free:
// the pure functions are unit-tested in booking.test.js and the API
// orchestrators take the axios instance as a parameter so they can be
// exercised with a stub.
//
// Backend contract reminders (ROADMAP-V6 1.8):
//   - NUMERIC columns arrive as strings, DATE columns as ISO timestamps —
//     normalize at the edge with parseFloat / dayjs(x).format("YYYY-MM-DD").
//   - POST /transactions with receiptId links the receipt atomically and the
//     201 body carries `receipt: { id, status: "linked" }`; an older API
//     returns the bare transaction, in which case PUT /receipts/:id/link
//     finishes the job (idempotent 200).
import dayjs from "dayjs";

// ── Formatting ────────────────────────────────────────────────

/** Currency formatter matching the web app (es-PR for Spanish). */
export const makeFmt =
  (lang, currency = "USD") =>
  (value) =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(value) || 0);

/** "YYYY-MM-DD" from an ISO timestamp / Date / date string; "" when empty. */
export const toDateInput = (value) => {
  if (!value) return "";
  const d = dayjs(value);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
};

/**
 * Parses an API numeric string or a user-typed amount ("12.50", "$1,234.00")
 * → number|NaN. Both app locales (en-US, es-PR) write the decimal as "." and
 * use "," for thousands, so commas are dropped.
 */
export const parseAmount = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  return cleaned === "" ? NaN : parseFloat(cleaned);
};

/** Keeps only digits and a single decimal point while typing. */
export const sanitizeAmountInput = (raw) => {
  const s = String(raw ?? "").replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot === -1) return s;
  return s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
};

// ── Receipt → form ────────────────────────────────────────────

/** Normalizes a receipt row into the editable review form fields. */
export function receiptToForm(receipt) {
  const items = Array.isArray(receipt?.ai_line_items)
    ? receipt.ai_line_items
    : [];
  const total = parseAmount(receipt?.ai_total);
  return {
    merchant: receipt?.ai_merchant || "",
    date: toDateInput(receipt?.ai_date),
    total: Number.isFinite(total) && total > 0 ? String(total) : "",
    lineItems: items.map((li) => ({
      description: li?.description || "",
      quantity: li?.quantity ?? null,
      unit_price: li?.unit_price ?? null,
      total: li?.total === null || li?.total === undefined ? "" : li.total,
    })),
  };
}

/** Confidence tier: same thresholds as the web (≥0.7 high, ≥0.4 medium). */
export const confidenceLevel = (value) => {
  const c = parseAmount(value);
  if (!Number.isFinite(c)) return "low";
  return c >= 0.7 ? "high" : c >= 0.4 ? "medium" : "low";
};

// ── Categorization rules (client replica of categorizationEngine.js) ──

/**
 * Same matching the backend applies when a transaction is created without a
 * category: merchant + notes lowercased; contains = substring, equals =
 * merchant exact (case-insensitive), regex = new RegExp(pattern, "i").
 */
export function ruleMatches(rule, merchant, notes) {
  if (!rule || !rule.pattern) return false;
  const matchText = [merchant, notes].filter(Boolean).join(" ").toLowerCase();
  const pattern = String(rule.pattern);
  if (rule.match_type === "contains") {
    return matchText.includes(pattern.toLowerCase());
  }
  if (rule.match_type === "equals") {
    return (merchant || "").toLowerCase() === pattern.toLowerCase();
  }
  if (rule.match_type === "regex") {
    try {
      return new RegExp(pattern, "i").test(matchText);
    } catch {
      return false; // invalid pattern — the backend skips it too
    }
  }
  return false;
}

/**
 * First active rule (priority ASC, then created_at ASC — the API already
 * returns them in that order) whose category type matches `type` and whose
 * pattern matches → { categoryId, ruleId } | null.
 */
export function suggestCategory(rules, merchant, notes, type) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  if (!merchant && !notes) return null;
  const ordered = [...rules].sort(
    (a, b) =>
      (Number(a.priority) || 0) - (Number(b.priority) || 0) ||
      String(a.created_at || "").localeCompare(String(b.created_at || "")),
  );
  for (const rule of ordered) {
    if (rule.is_active === false) continue;
    if (type && rule.category_type && rule.category_type !== type) continue;
    if (ruleMatches(rule, merchant, notes)) {
      return { categoryId: rule.category_id, ruleId: rule.id };
    }
  }
  return null;
}

// ── Chart of accounts ─────────────────────────────────────────

/**
 * Drops inactive accounts (and their subtrees) from the grouped
 * GET /chart-of-accounts response before coaToCategories() flattens it —
 * the flattened shape has no is_active field.
 */
export function filterActiveCoa(groups) {
  if (!Array.isArray(groups)) return [];
  const keep = (acc) => acc && acc.is_active !== false;
  const walk = (accounts) =>
    (accounts || []).filter(keep).map((acc) => ({
      ...acc,
      children: walk(acc.children),
    }));
  return groups.map((g) => ({ ...g, accounts: walk(g.accounts) }));
}

/**
 * Groups flattened categories for the picker: each top-level category is a
 * section (itself selectable) followed by its children. A child whose parent
 * was filtered out becomes a section headed by its parent_name.
 * → [{ key, name, parent: category|null, items: category[] }]
 */
export function groupCategories(categories) {
  const list = Array.isArray(categories) ? categories : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const sections = [];
  const index = new Map(); // section key → section

  const sectionFor = (key, name, parent) => {
    if (!index.has(key)) {
      const s = { key, name, parent, items: [] };
      index.set(key, s);
      sections.push(s);
    }
    return index.get(key);
  };

  for (const cat of list) {
    if (!cat.parent_id) {
      sectionFor(`cat:${cat.id}`, cat.name, cat);
    } else if (byId.has(cat.parent_id)) {
      const parent = byId.get(cat.parent_id);
      sectionFor(`cat:${parent.id}`, parent.name, parent).items.push(cat);
    } else {
      sectionFor(
        `orphan:${cat.parent_name || ""}`,
        cat.parent_name || "",
        null,
      ).items.push(cat);
    }
  }
  return sections;
}

/** Case/diacritic-insensitive substring search over category names. */
export function searchCategories(categories, query) {
  const q = normalize(query);
  if (!q) return categories || [];
  return (categories || []).filter(
    (c) =>
      normalize(c.name).includes(q) || normalize(c.parent_name).includes(q),
  );
}

const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .trim();

// ── Splits ────────────────────────────────────────────────────

/** Seeds one split row per line item with a positive total. */
export function seedSplitsFromLineItems(lineItems) {
  return (lineItems || [])
    .filter((li) => parseAmount(li.total) > 0)
    .map((li) => ({
      categoryId: "",
      amount: String(parseAmount(li.total)),
      notes: li.description || "",
    }));
}

export const splitsTotal = (splits) =>
  (splits || []).reduce((sum, s) => {
    const n = parseAmount(s.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

// ── Validation ────────────────────────────────────────────────

/**
 * Client-side checks before booking. Returns an i18n key under
 * mobile.review.errors.* or null when the form can be sent.
 * `form`: { total, accountId, type, categoryId, useSplit, splits }
 */
export function validateBooking(form) {
  const total = parseAmount(form.total);
  if (!Number.isFinite(total) || total <= 0) {
    return "mobile.review.errors.validTotal";
  }
  if (!form.accountId) return "mobile.review.errors.selectAccount";
  if (form.useSplit) {
    const splits = form.splits || [];
    if (splits.length === 0) return "mobile.review.errors.selectCategory";
    for (const s of splits) {
      if (!s.categoryId || !(parseAmount(s.amount) > 0)) {
        return "mobile.review.errors.selectCategory";
      }
    }
    if (Math.abs(splitsTotal(splits) - total) > 0.01) {
      return "mobile.review.errors.splitsMustMatch";
    }
  } else if (!form.categoryId) {
    return "mobile.review.errors.selectCategory";
  }
  return null;
}

// ── Payloads ──────────────────────────────────────────────────

/** Body for PUT /receipts/:id/review (undefined fields keep the old value). */
export function buildReviewPayload(form) {
  const total = parseAmount(form.total);
  return {
    merchant: form.merchant?.trim() || undefined,
    date: form.date || undefined,
    total: Number.isFinite(total) && total > 0 ? total : undefined,
    lineItems: (form.lineItems || []).map((li) => {
      const n = parseAmount(li.total);
      return {
        description: li.description || "",
        quantity: li.quantity ?? null,
        unit_price: li.unit_price ?? null,
        total: Number.isFinite(n) ? n : null,
      };
    }),
  };
}

/** Body for POST /transactions — the phone always funds from a bank account. */
export function buildTransactionPayload({ receiptId, form }) {
  const payload = {
    accountId: form.accountId,
    date: form.date || dayjs().format("YYYY-MM-DD"),
    merchant: form.merchant?.trim() || undefined,
    totalAmount: parseAmount(form.total),
    type: form.type === "income" ? "income" : "expense",
    notes: form.notes?.trim() || undefined,
    receiptId,
  };
  if (form.useSplit) {
    payload.splits = (form.splits || []).map((s) => ({
      categoryId: s.categoryId,
      amount: parseAmount(s.amount),
      notes: s.notes?.trim() || undefined,
    }));
  } else {
    payload.categoryId = form.categoryId;
  }
  return payload;
}

// ── Transaction matching (link to an existing transaction) ────

export const AMOUNT_TOLERANCE = 0.01; // ±1 %
export const DATE_TOLERANCE_DAYS = 7;

/**
 * Score for ranking candidates. 0 = not a likely match. Otherwise a value in
 * (1, 3]: closer amount and date score higher. Requires the amount within
 * ±1 % of the receipt total; the date within ±7 days when the receipt has a
 * date (a receipt without a date matches on amount alone).
 */
export function matchScore(tx, total, date) {
  const target = parseAmount(total);
  if (!Number.isFinite(target) || target <= 0) return 0;
  const amount = parseAmount(tx?.total_amount);
  if (!Number.isFinite(amount)) return 0;
  const amountDiff = Math.abs(amount - target) / target;
  if (amountDiff > AMOUNT_TOLERANCE) return 0;

  let dateScore = 1;
  if (date) {
    const a = dayjs(toDateInput(date));
    const b = dayjs(toDateInput(tx?.date));
    if (!a.isValid() || !b.isValid()) return 0;
    const dayDiff = Math.abs(a.diff(b, "day"));
    if (dayDiff > DATE_TOLERANCE_DAYS) return 0;
    dateScore = 1 - dayDiff / (DATE_TOLERANCE_DAYS + 1);
  }
  const amountScore = 1 - amountDiff / AMOUNT_TOLERANCE;
  return 1 + amountScore + dateScore;
}

/** Splits candidates into { likely (best first), rest (API order) }. */
export function rankTransactions(transactions, total, date) {
  const likely = [];
  const rest = [];
  for (const tx of transactions || []) {
    const score = matchScore(tx, total, date);
    if (score > 0) likely.push({ tx, score });
    else rest.push(tx);
  }
  likely.sort((a, b) => b.score - a.score);
  return { likely: likely.map((l) => l.tx), rest };
}

// ── Error classification ──────────────────────────────────────

/** The backend found no category (and rules matched nothing). */
export const isCategoryRequiredError = (err) =>
  err?.response?.status === 400 &&
  /categoryId or splits/i.test(String(err.response?.data?.error || ""));

// ── API orchestration ─────────────────────────────────────────

/** PUT /receipts/:id/review → updated row. */
export async function saveReview({ api, receipt, form }) {
  const { data } = await api.put(
    `/receipts/${receipt.id}/review`,
    buildReviewPayload(form),
  );
  return data;
}

/**
 * Review + book in one go:
 *   1. PUT /receipts/:id/review (persist the user's corrections),
 *   2. POST /transactions { ..., receiptId } — links atomically (201 body
 *      carries `receipt`),
 *   3. older API without `receipt` in the body → PUT /receipts/:id/link
 *      (idempotent; a 409 RECEIPT_LINKED here means it is already done).
 * Resolves { transaction, linked: true }. Rejects with the axios error.
 */
export async function bookReceipt({ api, receipt, form }) {
  await saveReview({ api, receipt, form });
  const { data: transaction } = await api.post(
    "/transactions",
    buildTransactionPayload({ receiptId: receipt.id, form }),
  );
  if (!transaction?.receipt) {
    try {
      await api.put(`/receipts/${receipt.id}/link`, {
        transactionId: transaction.id,
      });
    } catch (err) {
      if (err?.response?.status !== 409) throw err;
    }
  }
  return { transaction, linked: true };
}

/** PUT /receipts/:id/link { transactionId } → { message }. */
export async function linkReceipt({ api, receiptId, transactionId }) {
  const { data } = await api.put(`/receipts/${receiptId}/link`, {
    transactionId,
  });
  return data;
}

/** DELETE /receipts/:id. */
export async function deleteReceipt({ api, receiptId }) {
  const { data } = await api.delete(`/receipts/${receiptId}`);
  return data;
}
