import { describe, it, expect } from "vitest";
import {
  accountLabel,
  amountParts,
  categoryLabel,
  formatMoney,
  formatTxDate,
  toNumber,
} from "./transactionFormat.js";

/** i18n double: COA keys resolve to a readable name, others echo the key. */
const t = (key) =>
  ({
    "coa.accounts.groceries": "Groceries",
    "coa.accounts.cash": "Cash",
  })[key] || key;

describe("formatTxDate", () => {
  it("formats the API's ISO timestamps as MMM D, YYYY", () => {
    expect(formatTxDate("2026-03-04T04:00:00.000Z")).toMatch(
      /^Mar [34], 2026$/,
    );
    expect(formatTxDate("2026-03-04")).toBe("Mar 4, 2026");
    expect(formatTxDate(null)).toBeNull();
    expect(formatTxDate("garbage")).toBeNull();
  });
});

describe("categoryLabel", () => {
  it("translates a name_key and falls back to the plain name", () => {
    expect(
      categoryLabel({ splits: [{ name_key: "coa.accounts.groceries" }] }, t),
    ).toBe("Groceries");
    expect(categoryLabel({ splits: [{ name: "Marketing" }] }, t)).toBe(
      "Marketing",
    );
    // Without a translator the key itself is shown (never throws).
    expect(categoryLabel({ splits: [{ name_key: "coa.accounts.cash" }] })).toBe(
      "coa.accounts.cash",
    );
  });

  it("appends +N for split transactions only", () => {
    const splits = [{ name: "Food" }, { name: "Tips" }, { name: "Tax" }];
    expect(categoryLabel({ is_split: true, splits }, t)).toBe("Food +2");
    expect(categoryLabel({ is_split: false, splits }, t)).toBe("Food");
    expect(
      categoryLabel({ is_split: true, splits: [{ name: "Food" }] }, t),
    ).toBe("Food");
  });

  it("shows a dash when the row has no revenue/expense line", () => {
    expect(categoryLabel({ splits: [] }, t)).toBe("—");
    expect(categoryLabel({}, t)).toBe("—");
    expect(categoryLabel(null, t)).toBe("—");
    expect(categoryLabel({ splits: [{ name: null }] }, t)).toBe("—");
  });
});

describe("accountLabel", () => {
  it("prefers the ledger name_key, then the operational account name", () => {
    expect(
      accountLabel(
        { account_name_key: "coa.accounts.cash", account_name: "Cash" },
        t,
      ),
    ).toBe("Cash");
    expect(accountLabel({ account_name: "Banco Popular" }, t)).toBe(
      "Banco Popular",
    );
    expect(accountLabel({}, t)).toBe("—");
  });
});

describe("amountParts", () => {
  it("signs and tones by type and normalises the NUMERIC string", () => {
    expect(amountParts({ type: "income", total_amount: "1250.50" })).toEqual({
      sign: "+",
      tone: "income",
      value: 1250.5,
    });
    expect(amountParts({ type: "expense", total_amount: "45" })).toEqual({
      sign: "−",
      tone: "expense",
      value: 45,
    });
    expect(
      amountParts({ type: "expense", total_amount: null }).value,
    ).toBeNull();
    expect(amountParts(undefined).tone).toBe("expense");
  });

  it("re-exports the money helpers the rows render with", () => {
    expect(formatMoney("12.5", "USD")).toBe("$12.50");
    expect(toNumber("3.25")).toBe(3.25);
  });
});
