import { describe, it, expect, vi } from "vitest";
import {
  bookReceipt,
  buildReviewPayload,
  buildTransactionPayload,
  confidenceLevel,
  filterActiveCoa,
  groupCategories,
  isCategoryRequiredError,
  matchScore,
  parseAmount,
  rankTransactions,
  receiptToForm,
  ruleMatches,
  sanitizeAmountInput,
  searchCategories,
  seedSplitsFromLineItems,
  suggestCategory,
  toDateInput,
  validateBooking,
} from "./booking.js";

// ── Formatting / normalization ────────────────────────────────

describe("amount + date normalization", () => {
  it("parses numeric strings the API sends and user-typed amounts", () => {
    expect(parseAmount("12.50")).toBe(12.5);
    expect(parseAmount("$1,234.00")).toBe(1234); // "," = thousands (en-US / es-PR)
    expect(parseAmount("-3.25")).toBe(-3.25);
    expect(parseAmount(7)).toBe(7);
    expect(Number.isNaN(parseAmount(""))).toBe(true);
    expect(Number.isNaN(parseAmount(null))).toBe(true);
  });

  it("keeps a single decimal point while typing", () => {
    expect(sanitizeAmountInput("12.5.7")).toBe("12.57");
    expect(sanitizeAmountInput("1,250")).toBe("1250");
    expect(sanitizeAmountInput("abc")).toBe("");
    expect(sanitizeAmountInput("$40")).toBe("40");
  });

  it("formats ISO timestamps as YYYY-MM-DD", () => {
    expect(toDateInput("2026-03-04T04:00:00.000Z")).toMatch(/^2026-03-0[34]$/);
    expect(toDateInput(null)).toBe("");
    expect(toDateInput("not a date")).toBe("");
  });

  it("uses the web's confidence thresholds", () => {
    expect(confidenceLevel("0.92")).toBe("high");
    expect(confidenceLevel(0.7)).toBe("high");
    expect(confidenceLevel(0.69)).toBe("medium");
    expect(confidenceLevel(0.4)).toBe("medium");
    expect(confidenceLevel("0.1")).toBe("low");
    expect(confidenceLevel(null)).toBe("low");
  });
});

describe("receiptToForm", () => {
  it("normalizes strings/timestamps at the edge", () => {
    const form = receiptToForm({
      ai_merchant: "Walgreens",
      ai_date: "2026-01-15T05:00:00.000Z",
      ai_total: "23.45",
      ai_line_items: [
        { description: "Milk", quantity: 1, unit_price: 3.5, total: 3.5 },
        { description: "Bread", total: null },
      ],
    });
    expect(form.merchant).toBe("Walgreens");
    expect(form.date).toMatch(/^2026-01-1[45]$/);
    expect(form.total).toBe("23.45");
    expect(form.lineItems).toHaveLength(2);
    expect(form.lineItems[0]).toMatchObject({
      description: "Milk",
      total: 3.5,
    });
    expect(form.lineItems[1].total).toBe("");
  });

  it("tolerates a receipt the AI could not read", () => {
    const form = receiptToForm({
      ai_merchant: null,
      ai_date: null,
      ai_total: null,
      ai_line_items: null,
    });
    expect(form).toEqual({ merchant: "", date: "", total: "", lineItems: [] });
  });
});

// ── Rules ─────────────────────────────────────────────────────

describe("ruleMatches (replica of categorizationEngine.js)", () => {
  it("contains: substring over merchant + notes, case-insensitive", () => {
    const rule = { match_type: "contains", pattern: "AMAZON" };
    expect(ruleMatches(rule, "Amazon Marketplace", "")).toBe(true);
    expect(ruleMatches(rule, "Costco", "paid via amazon pay")).toBe(true);
    expect(ruleMatches(rule, "Costco", "")).toBe(false);
  });

  it("equals: merchant exact match only, ignores notes", () => {
    const rule = { match_type: "equals", pattern: "costco" };
    expect(ruleMatches(rule, "Costco", "x")).toBe(true);
    expect(ruleMatches(rule, "Costco Gas", "")).toBe(false);
    expect(ruleMatches(rule, "", "costco")).toBe(false);
  });

  it("regex: case-insensitive over merchant + notes; invalid pattern never matches", () => {
    expect(
      ruleMatches(
        { match_type: "regex", pattern: "^shell|texaco" },
        "SHELL 123",
        "",
      ),
    ).toBe(true);
    expect(
      ruleMatches({ match_type: "regex", pattern: "(" }, "anything", ""),
    ).toBe(false);
  });

  it("unknown match types and empty patterns never match", () => {
    expect(ruleMatches({ match_type: "fuzzy", pattern: "a" }, "a", "")).toBe(
      false,
    );
    expect(ruleMatches({ match_type: "contains", pattern: "" }, "a", "")).toBe(
      false,
    );
    expect(ruleMatches(null, "a", "")).toBe(false);
  });
});

describe("suggestCategory", () => {
  const rules = [
    {
      id: "r2",
      priority: 2,
      match_type: "contains",
      pattern: "shell",
      category_id: "cat-fuel-2",
      is_active: true,
      category_type: "expense",
    },
    {
      id: "r1",
      priority: 1,
      match_type: "contains",
      pattern: "shell",
      category_id: "cat-fuel-1",
      is_active: true,
      category_type: "expense",
    },
    {
      id: "r0",
      priority: 0,
      match_type: "contains",
      pattern: "shell",
      category_id: "cat-inactive",
      is_active: false,
      category_type: "expense",
    },
    {
      id: "r3",
      priority: 3,
      match_type: "contains",
      pattern: "deposit",
      category_id: "cat-sales",
      is_active: true,
      category_type: "income",
    },
  ];

  it("returns the lowest-priority active rule of the right type", () => {
    expect(suggestCategory(rules, "Shell Station", "", "expense")).toEqual({
      categoryId: "cat-fuel-1",
      ruleId: "r1",
    });
  });

  it("skips rules whose category type differs from the transaction type", () => {
    expect(suggestCategory(rules, "Shell Station", "", "income")).toBeNull();
    expect(
      suggestCategory(rules, "Bank", "customer deposit", "income"),
    ).toEqual({ categoryId: "cat-sales", ruleId: "r3" });
  });

  it("returns null with nothing to match against", () => {
    expect(suggestCategory(rules, "", "", "expense")).toBeNull();
    expect(suggestCategory([], "Shell", "", "expense")).toBeNull();
    expect(suggestCategory(null, "Shell", "", "expense")).toBeNull();
  });
});

// ── Chart of accounts ─────────────────────────────────────────

describe("filterActiveCoa + groupCategories + searchCategories", () => {
  const groups = [
    {
      account_type: "expense",
      accounts: [
        {
          id: "p1",
          name: "Operating",
          is_active: true,
          children: [
            { id: "c1", name: "Fuel", is_active: true, children: [] },
            { id: "c2", name: "Old", is_active: false, children: [] },
          ],
        },
        { id: "p2", name: "Retired", is_active: false, children: [] },
      ],
    },
  ];

  it("drops inactive accounts and their subtrees", () => {
    const [g] = filterActiveCoa(groups);
    expect(g.accounts.map((a) => a.id)).toEqual(["p1"]);
    expect(g.accounts[0].children.map((c) => c.id)).toEqual(["c1"]);
    expect(filterActiveCoa(null)).toEqual([]);
  });

  it("groups children under their (selectable) parent, orphans by parent_name", () => {
    const cats = [
      { id: "p1", name: "Operating", parent_id: null, parent_name: null },
      { id: "c1", name: "Fuel", parent_id: "p1", parent_name: "Operating" },
      { id: "c9", name: "Lost", parent_id: "gone", parent_name: "Ghost" },
    ];
    const sections = groupCategories(cats);
    expect(sections).toHaveLength(2);
    expect(sections[0].parent.id).toBe("p1");
    expect(sections[0].items.map((c) => c.id)).toEqual(["c1"]);
    expect(sections[1].parent).toBeNull();
    expect(sections[1].name).toBe("Ghost");
    expect(sections[1].items.map((c) => c.id)).toEqual(["c9"]);
  });

  it("searches names and parent names ignoring case and accents", () => {
    const cats = [
      { id: "a", name: "Gasolina", parent_name: "Vehículo" },
      { id: "b", name: "Nómina", parent_name: null },
    ];
    expect(searchCategories(cats, "vehiculo").map((c) => c.id)).toEqual(["a"]);
    expect(searchCategories(cats, "NOMINA").map((c) => c.id)).toEqual(["b"]);
    expect(searchCategories(cats, "")).toHaveLength(2);
  });
});

// ── Splits + validation ───────────────────────────────────────

describe("splits + validation", () => {
  it("seeds one split per line item with a positive total", () => {
    expect(
      seedSplitsFromLineItems([
        { description: "Milk", total: "3.50" },
        { description: "Discount", total: -1 },
        { description: "Bag", total: 0 },
        { description: "Eggs", total: 4 },
      ]),
    ).toEqual([
      { categoryId: "", amount: "3.5", notes: "Milk" },
      { categoryId: "", amount: "4", notes: "Eggs" },
    ]);
  });

  const base = {
    total: "10",
    accountId: "acc",
    type: "expense",
    categoryId: "cat",
    useSplit: false,
    splits: [],
  };

  it("validates total, account, category and split balance in order", () => {
    expect(validateBooking(base)).toBeNull();
    expect(validateBooking({ ...base, total: "0" })).toBe(
      "mobile.review.errors.validTotal",
    );
    expect(validateBooking({ ...base, accountId: "" })).toBe(
      "mobile.review.errors.selectAccount",
    );
    expect(validateBooking({ ...base, categoryId: "" })).toBe(
      "mobile.review.errors.selectCategory",
    );
    expect(validateBooking({ ...base, useSplit: true, splits: [] })).toBe(
      "mobile.review.errors.selectCategory",
    );
    expect(
      validateBooking({
        ...base,
        useSplit: true,
        splits: [{ categoryId: "", amount: "10" }],
      }),
    ).toBe("mobile.review.errors.selectCategory");
    expect(
      validateBooking({
        ...base,
        useSplit: true,
        splits: [
          { categoryId: "a", amount: "6" },
          { categoryId: "b", amount: "3" },
        ],
      }),
    ).toBe("mobile.review.errors.splitsMustMatch");
    expect(
      validateBooking({
        ...base,
        useSplit: true,
        splits: [
          { categoryId: "a", amount: "6" },
          { categoryId: "b", amount: "4" },
        ],
      }),
    ).toBeNull();
  });
});

// ── Payloads ──────────────────────────────────────────────────

describe("payload builders", () => {
  it("review payload leaves untouched fields undefined and numbers numeric", () => {
    const p = buildReviewPayload({
      merchant: "  Costco ",
      date: "",
      total: "45.10",
      lineItems: [{ description: "x", total: "5" }, { description: "y" }],
    });
    expect(p).toEqual({
      merchant: "Costco",
      date: undefined,
      total: 45.1,
      lineItems: [
        { description: "x", quantity: null, unit_price: null, total: 5 },
        { description: "y", quantity: null, unit_price: null, total: null },
      ],
    });
  });

  it("transaction payload: category mode always funds from a bank account", () => {
    const p = buildTransactionPayload({
      receiptId: "rcpt",
      form: {
        accountId: "acc",
        date: "2026-02-01",
        merchant: "Costco",
        total: "45.10",
        type: "expense",
        categoryId: "cat",
        useSplit: false,
        notes: "",
      },
    });
    expect(p).toEqual({
      accountId: "acc",
      date: "2026-02-01",
      merchant: "Costco",
      totalAmount: 45.1,
      type: "expense",
      notes: undefined,
      receiptId: "rcpt",
      categoryId: "cat",
    });
    expect(p).not.toHaveProperty("fundingCoaId");
    expect(p).not.toHaveProperty("splits");
  });

  it("transaction payload: split mode sends splits and no categoryId", () => {
    const p = buildTransactionPayload({
      receiptId: "rcpt",
      form: {
        accountId: "acc",
        date: "",
        total: "10",
        type: "income",
        useSplit: true,
        splits: [
          { categoryId: "a", amount: "6", notes: " Milk " },
          { categoryId: "b", amount: "4", notes: "" },
        ],
      },
    });
    expect(p.type).toBe("income");
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.splits).toEqual([
      { categoryId: "a", amount: 6, notes: "Milk" },
      { categoryId: "b", amount: 4, notes: undefined },
    ]);
    expect(p).not.toHaveProperty("categoryId");
  });
});

// ── Transaction matching ──────────────────────────────────────

describe("matchScore + rankTransactions", () => {
  const tx = (id, total_amount, date, extra = {}) => ({
    id,
    total_amount,
    date,
    ...extra,
  });

  it("requires the amount within ±1 % and the date within ±7 days", () => {
    expect(
      matchScore(tx("a", "100.00", "2026-05-10"), "100", "2026-05-10"),
    ).toBeGreaterThan(0);
    expect(
      matchScore(tx("b", "100.90", "2026-05-10"), "100", "2026-05-10"),
    ).toBeGreaterThan(0);
    expect(
      matchScore(tx("c", "101.50", "2026-05-10"), "100", "2026-05-10"),
    ).toBe(0);
    expect(
      matchScore(tx("d", "100.00", "2026-05-18"), "100", "2026-05-10"),
    ).toBe(0);
    expect(
      matchScore(
        tx("e", "100.00", "2026-05-17T04:00:00.000Z"),
        "100",
        "2026-05-10",
      ),
    ).toBeGreaterThan(0);
  });

  it("a receipt without a date matches on amount alone; without a total nothing matches", () => {
    expect(matchScore(tx("a", "100", "2020-01-01"), "100", "")).toBeGreaterThan(
      0,
    );
    expect(matchScore(tx("a", "100", "2026-05-10"), "", "2026-05-10")).toBe(0);
    expect(matchScore(tx("a", "abc", "2026-05-10"), "100", "2026-05-10")).toBe(
      0,
    );
  });

  it("ranks the closest amount/date first and keeps the rest in API order", () => {
    const list = [
      tx("far", "500", "2026-05-10"),
      tx("close-date", "100", "2026-05-12"),
      tx("exact", "100", "2026-05-10"),
      tx("close-amount", "100.80", "2026-05-10"),
      tx("older", "20", "2026-01-01"),
    ];
    const { likely, rest } = rankTransactions(list, "100", "2026-05-10");
    expect(likely.map((t) => t.id)).toEqual([
      "exact",
      "close-date",
      "close-amount",
    ]);
    expect(rest.map((t) => t.id)).toEqual(["far", "older"]);
    expect(rankTransactions(null, "100", "2026-05-10")).toEqual({
      likely: [],
      rest: [],
    });
  });
});

// ── Errors ────────────────────────────────────────────────────

describe("isCategoryRequiredError", () => {
  it("detects the backend's 'no category' 400", () => {
    expect(
      isCategoryRequiredError({
        response: {
          status: 400,
          data: { error: "A categoryId or splits[] is required" },
        },
      }),
    ).toBe(true);
    expect(
      isCategoryRequiredError({
        response: { status: 400, data: { error: "totalAmount must be > 0" } },
      }),
    ).toBe(false);
    expect(isCategoryRequiredError({ response: { status: 409 } })).toBe(false);
    expect(isCategoryRequiredError(null)).toBe(false);
  });
});

// ── bookReceipt orchestration (stubbed axios) ─────────────────

function fakeApi({ postBody, linkStatus } = {}) {
  const calls = [];
  const api = {
    put: vi.fn(async (url, body) => {
      calls.push(["put", url, body]);
      if (url.endsWith("/link") && linkStatus && linkStatus >= 400) {
        const err = new Error("link failed");
        err.response = { status: linkStatus, data: { code: "RECEIPT_LINKED" } };
        throw err;
      }
      return { data: { id: "rcpt", status: "reviewed" } };
    }),
    post: vi.fn(async (url, body) => {
      calls.push(["post", url, body]);
      return { data: postBody };
    }),
  };
  return { api, calls };
}

const receipt = { id: "rcpt" };
const form = {
  merchant: "Costco",
  date: "2026-02-01",
  total: "45.10",
  lineItems: [],
  accountId: "acc",
  type: "expense",
  categoryId: "cat",
  useSplit: false,
  splits: [],
  notes: "",
};

describe("bookReceipt", () => {
  it("reviews, books, and skips PUT /link when the 201 body carries `receipt`", async () => {
    const { api, calls } = fakeApi({
      postBody: { id: "tx1", receipt: { id: "rcpt", status: "linked" } },
    });
    const result = await bookReceipt({ api, receipt, form });
    expect(result.linked).toBe(true);
    expect(result.transaction.id).toBe("tx1");
    expect(calls.map((c) => [c[0], c[1]])).toEqual([
      ["put", "/receipts/rcpt/review"],
      ["post", "/transactions"],
    ]);
    expect(calls[1][2]).toMatchObject({ receiptId: "rcpt", accountId: "acc" });
  });

  it("falls back to PUT /link against an older API (no `receipt` in the body)", async () => {
    const { api, calls } = fakeApi({ postBody: { id: "tx2" } });
    await bookReceipt({ api, receipt, form });
    expect(calls[2]).toEqual([
      "put",
      "/receipts/rcpt/link",
      { transactionId: "tx2" },
    ]);
  });

  it("tolerates a 409 from the fallback link (already linked = done)", async () => {
    const { api } = fakeApi({ postBody: { id: "tx3" }, linkStatus: 409 });
    await expect(bookReceipt({ api, receipt, form })).resolves.toMatchObject({
      linked: true,
    });
  });

  it("propagates any other failure", async () => {
    const { api } = fakeApi({ postBody: { id: "tx4" }, linkStatus: 500 });
    await expect(bookReceipt({ api, receipt, form })).rejects.toThrow();
  });
});
