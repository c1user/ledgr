import { describe, it, expect } from "vitest";
import {
  statusTone,
  parseStatusFilter,
  toNumber,
  formatMoney,
  formatReceiptDate,
  confidencePct,
  isHalfLinked,
  isPdf,
  lineItems,
  STATUS_LABEL_KEYS,
  FILTER_LABEL_KEYS,
  FILTERS,
} from "./receiptFormat.js";

describe("receiptFormat", () => {
  it("maps statuses to the web's badge tones", () => {
    expect(statusTone("pending")).toBe("expense");
    expect(statusTone("reviewed")).toBe("payroll");
    expect(statusTone("linked")).toBe("income");
    expect(statusTone("weird")).toBe("neutral");
    expect(statusTone(undefined)).toBe("neutral");
  });

  it("has a literal label key for every status and filter", () => {
    expect(Object.keys(STATUS_LABEL_KEYS)).toEqual([
      "pending",
      "reviewed",
      "linked",
    ]);
    for (const f of FILTERS) expect(FILTER_LABEL_KEYS[f]).toMatch(/^mobile\./);
  });

  it("accepts only known ?status= values", () => {
    expect(parseStatusFilter("pending")).toBe("pending");
    expect(parseStatusFilter("linked")).toBe("linked");
    expect(parseStatusFilter("all")).toBe("all");
    expect(parseStatusFilter("drop table")).toBe("all");
    expect(parseStatusFilter(null)).toBe("all");
  });

  it("normalises NUMERIC strings at the edge", () => {
    expect(toNumber("12.50")).toBe(12.5);
    expect(toNumber(3)).toBe(3);
    expect(toNumber(null)).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
  });

  it("formats money with the business currency and falls back to USD", () => {
    expect(formatMoney("1234.5", "USD")).toBe("$1,234.50");
    expect(formatMoney(null, "USD")).toBeNull();
    expect(formatMoney("oops", "USD")).toBeNull();
    // Unknown currency codes must not throw.
    expect(formatMoney("1", "NOPE")).toBe("$1.00");
    // es-PR keeps the US-style grouping.
    expect(formatMoney("1234.5", "USD", "es")).toContain("1,234.50");
  });

  it("formats ISO timestamps as MMM D, YYYY", () => {
    expect(formatReceiptDate("2026-03-04T04:00:00.000Z")).toMatch(
      /^Mar [34], 2026$/,
    );
    expect(formatReceiptDate("2026-03-04")).toBe("Mar 4, 2026");
    expect(formatReceiptDate(null)).toBeNull();
    expect(formatReceiptDate("not a date")).toBeNull();
  });

  it("rounds AI confidence to a percent", () => {
    expect(confidencePct("0.874")).toBe(87);
    expect(confidencePct(1)).toBe(100);
    expect(confidencePct("1.7")).toBe(100);
    expect(confidencePct(null)).toBeNull();
  });

  it("detects half-linked rows (transaction set, status not linked)", () => {
    expect(isHalfLinked({ status: "reviewed", transaction_id: "t1" })).toBe(
      true,
    );
    expect(isHalfLinked({ status: "linked", transaction_id: "t1" })).toBe(
      false,
    );
    expect(isHalfLinked({ status: "pending", transaction_id: null })).toBe(
      false,
    );
    expect(isHalfLinked(null)).toBe(false);
  });

  it("recognises PDFs by filename or key", () => {
    expect(isPdf({ original_filename: "invoice.PDF" })).toBe(true);
    expect(isPdf({ s3_key: "receipts/1/abc.pdf" })).toBe(true);
    expect(isPdf({ original_filename: "receipt-2026.jpg" })).toBe(false);
    expect(isPdf(undefined)).toBe(false);
  });

  it("tolerates missing or malformed line items", () => {
    expect(lineItems({ ai_line_items: null })).toEqual([]);
    expect(lineItems({ ai_line_items: "x" })).toEqual([]);
    expect(
      lineItems({ ai_line_items: [{ description: "Coffee" }, null, 3] }),
    ).toEqual([{ description: "Coffee" }]);
  });
});
