import { describe, it, expect } from "vitest";
import {
  ACCOUNTS_QUERY_KEY,
  BALANCES_QUERY_KEY,
  TYPE_KEYS,
  TYPE_ICONS,
  splitActive,
  balanceTone,
  summaryOrZero,
  toNumber,
  formatMoney,
} from "./accountFormat.js";

const TYPES = ["current", "savings", "credit", "cash", "loan"];

describe("accountFormat", () => {
  it("uses the query keys the web, ReceiptReview and Settings already share", () => {
    expect(ACCOUNTS_QUERY_KEY).toEqual(["accounts"]);
    expect(BALANCES_QUERY_KEY).toEqual(["balances"]);
  });

  it("TYPE_KEYS and TYPE_ICONS cover exactly the five account types", () => {
    expect(Object.keys(TYPE_KEYS).sort()).toEqual([...TYPES].sort());
    expect(Object.keys(TYPE_ICONS).sort()).toEqual([...TYPES].sort());
    for (const type of TYPES) {
      expect(TYPE_KEYS[type]).toMatch(/^accounts\.type[A-Z]/);
      expect(TYPE_ICONS[type]).toMatch(/^ti-/);
    }
    // The values AccountPicker shipped with (it now imports these).
    expect(TYPE_KEYS.current).toBe("accounts.typeCurrent");
    expect(TYPE_KEYS.loan).toBe("accounts.typeLoan");
    expect(TYPE_ICONS.current).toBe("ti-building-bank");
    expect(TYPE_ICONS.credit).toBe("ti-credit-card");
  });

  it("splitActive keeps the API order and treats an undefined flag as active", () => {
    const rows = [
      { id: "a", is_active: true },
      { id: "b", is_active: false },
      { id: "c" },
      { id: "d", is_active: false },
      { id: "e", is_active: true },
    ];
    const { active, inactive } = splitActive(rows);
    expect(active.map((r) => r.id)).toEqual(["a", "c", "e"]);
    expect(inactive.map((r) => r.id)).toEqual(["b", "d"]);
    // The input rows are handed back untouched (same objects).
    expect(active[0]).toBe(rows[0]);
  });

  it("splitActive tolerates missing or malformed input", () => {
    expect(splitActive(undefined)).toEqual({ active: [], inactive: [] });
    expect(splitActive(null)).toEqual({ active: [], inactive: [] });
    expect(splitActive("x")).toEqual({ active: [], inactive: [] });
    expect(splitActive([{ id: "a" }, null, 3])).toEqual({
      active: [{ id: "a" }],
      inactive: [],
    });
  });

  it("balanceTone: negative → expense, zero/positive/missing → income", () => {
    expect(balanceTone("-12.00")).toBe("expense");
    expect(balanceTone(-0.01)).toBe("expense");
    expect(balanceTone("0.00")).toBe("income");
    expect(balanceTone("1250.00")).toBe("income");
    expect(balanceTone(null)).toBe("income");
    expect(balanceTone(undefined)).toBe("income");
    expect(balanceTone("abc")).toBe("income");
  });

  it("summaryOrZero: null SUMs → 0, NUMERIC strings → numbers", () => {
    expect(summaryOrZero(null)).toBe(0);
    expect(summaryOrZero(undefined)).toBe(0);
    expect(summaryOrZero("")).toBe(0);
    expect(summaryOrZero("1250.00")).toBe(1250);
    expect(summaryOrZero("-45.5")).toBe(-45.5);
    expect(summaryOrZero(7)).toBe(7);
    expect(summaryOrZero("garbage")).toBe(0);
  });

  it("re-exports the receipt money helpers unchanged", () => {
    expect(toNumber("12.50")).toBe(12.5);
    expect(toNumber(null)).toBeNull();
    expect(formatMoney("1234.5", "USD")).toBe("$1,234.50");
    expect(formatMoney(summaryOrZero(null), "USD")).toBe("$0.00");
    expect(formatMoney(summaryOrZero("-12"), "USD", "es")).toContain("12.00");
  });
});
