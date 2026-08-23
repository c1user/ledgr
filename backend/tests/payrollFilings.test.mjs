import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateSchedule,
  displayStatus,
} from "../src/services/complianceSchedule.js";
import {
  buildW2prFile,
  SUPPORTED_SPEC_VERSIONS,
} from "../src/services/w2prFile.js";

// ── schedule generation ──────────────────────────────────────

const RULES = {
  hacienda_deposit_schedule: {
    id: "r-dep",
    payload: { default_frequency: "monthly", monthly_due_day: 15 },
  },
  quarterly_filing_schedule: {
    id: "r-qf",
    payload: {
      filings: [
        {
          key: "hacienda_withholding_reconciliation",
          due_days_after_quarter_end: 31,
        },
        { key: "dtrh_unemployment_sinot", due_days_after_quarter_end: 31 },
      ],
    },
  },
  federal_employment_return: {
    id: "r-fed",
    payload: { filing_frequency: "quarterly", due_days_after_quarter_end: 31 },
  },
  w2pr_file_spec: {
    id: "r-w2",
    payload: {
      spec_version: "TY2025-PLACEHOLDER",
      generation_window: { start: "01-01", end: "01-31" },
    },
  },
  cfse_declaration: {
    id: "r-cfse",
    payload: { annual_due: "07-20", period: { start: "07-01", end: "06-30" } },
  },
  christmas_bonus: {
    id: "r-bonus",
    payload: {
      payment_window: { start: "11-15", end: "12-15" },
      accrual_window: { start: "10-01", end: "09-30" },
    },
  },
};

test("schedule: 12 deposits + 8 quarterlies + 4 federal + 3 annuals", () => {
  const out = generateSchedule(RULES, 2026);
  const byType = (t) => out.filter((o) => o.obligation_type === t);
  assert.equal(byType("hacienda_deposit").length, 12);
  assert.equal(byType("hacienda_withholding_reconciliation").length, 4);
  assert.equal(byType("dtrh_unemployment_sinot").length, 4);
  assert.equal(byType("federal_employment_return").length, 4);
  assert.equal(byType("w2pr_annual").length, 1);
  assert.equal(byType("cfse_declaration").length, 1);
  assert.equal(byType("bonus_payment").length, 1);
  assert.equal(out.length, 27);
});

test("schedule date math from rule payloads", () => {
  const out = generateSchedule(RULES, 2026);
  const january = out.find(
    (o) =>
      o.obligation_type === "hacienda_deposit" &&
      o.period_start === "2026-01-01",
  );
  assert.equal(january.period_end, "2026-01-31");
  assert.equal(january.due_date, "2026-02-15");

  const december = out.find(
    (o) =>
      o.obligation_type === "hacienda_deposit" &&
      o.period_start === "2026-12-01",
  );
  assert.equal(december.due_date, "2027-01-15"); // crosses the year

  const q1 = out.find(
    (o) =>
      o.obligation_type === "hacienda_withholding_reconciliation" &&
      o.period_start === "2026-01-01",
  );
  assert.equal(q1.period_end, "2026-03-31");
  assert.equal(q1.due_date, "2026-05-01"); // Mar 31 + 31 days

  const w2 = out.find((o) => o.obligation_type === "w2pr_annual");
  assert.equal(w2.period_start, "2025-01-01"); // prior tax year
  assert.equal(w2.due_date, "2026-01-31");

  const cfse = out.find((o) => o.obligation_type === "cfse_declaration");
  assert.equal(cfse.period_start, "2025-07-01");
  assert.equal(cfse.period_end, "2026-06-30");
  assert.equal(cfse.due_date, "2026-07-20");

  // Every obligation carries the rule version that scheduled it.
  assert.ok(out.every((o) => o.rule_id));
});

test("missing schedule rules simply produce no obligations of that type", () => {
  const out = generateSchedule(
    { hacienda_deposit_schedule: RULES.hacienda_deposit_schedule },
    2026,
  );
  assert.equal(out.length, 12);
});

test("display status ladder: done > late > ready > upcoming", () => {
  const base = { period_end: "2026-03-31", due_date: "2026-05-01" };
  assert.equal(
    displayStatus({ ...base, status: "done" }, "2026-06-01"),
    "done",
  );
  assert.equal(
    displayStatus({ ...base, status: "upcoming" }, "2026-06-01"),
    "late",
  );
  assert.equal(
    displayStatus({ ...base, status: "upcoming" }, "2026-04-15"),
    "ready",
  );
  assert.equal(
    displayStatus({ ...base, status: "upcoming" }, "2026-02-01"),
    "upcoming",
  );
});

// ── W-2PR file builder ───────────────────────────────────────

const EMPLOYER = {
  name: "El Fogón Criollo",
  address: "Calle Loíza 123",
  city: "San Juan",
  state: "PR",
  zip: "00911",
  tax_id: "660891234",
};

const EMP = {
  name: "Carmen Delgado",
  ssn: "123456789",
  grossCents: 4000000,
  prTaxCents: 320000,
  ssWagesCents: 4000000,
  ssWithheldCents: 248000,
  medicareWagesCents: 4000000,
  medicareWithheldCents: 58000,
};

test("W-2PR file: RA/RE/RS/RT/RF records, all exactly 512 chars", () => {
  // Pinned to the placeholder layout — the EFW2PR layout has its own suite
  // (tests/efw2pr.test.mjs).
  const { content, filename, warnings } = buildW2prFile({
    specVersion: "TY2025-PLACEHOLDER",
    year: 2026,
    employer: EMPLOYER,
    employees: [EMP, { ...EMP, name: "Jorge Meléndez", ssn: "987654321" }],
  });
  // trimEnd would eat RF's trailing space padding — split precisely.
  const records = content.split("\r\n");
  assert.equal(records.at(-1), ""); // file ends with CRLF
  records.pop();
  assert.equal(records.length, 6); // RA RE RS RS RT RF
  assert.deepEqual(
    records.map((r) => r.slice(0, 2)),
    ["RA", "RE", "RS", "RS", "RT", "RF"],
  );
  assert.ok(records.every((r) => r.length === 512));
  assert.equal(filename, "W2PR2026.txt");
  assert.deepEqual(warnings, []);
  assert.ok(records[2].includes("123456789"));
  assert.ok(records[2].includes("CARMEN DELGADO"));
});

test("W-2PR totals record sums employees", () => {
  const { content } = buildW2prFile({
    specVersion: "TY2025-PLACEHOLDER",
    year: 2026,
    employer: EMPLOYER,
    employees: [EMP, EMP],
  });
  const rt = content.split("\r\n")[3 + 1]; // after RA RE RS RS
  // gross total 8,000,000 cents in a 15-wide zero-filled field
  assert.ok(rt.includes("000000008000000"));
});

test("missing SSN produces a warning, never a silent zero-fill", () => {
  const { warnings } = buildW2prFile({
    specVersion: "TY2025-PLACEHOLDER",
    year: 2026,
    employer: EMPLOYER,
    employees: [{ ...EMP, ssn: null }],
  });
  assert.match(warnings[0], /missing_ssn: Carmen Delgado/);
});

test("an unimplemented spec version fails loudly — the layout can never silently go stale", () => {
  assert.throws(
    () =>
      buildW2prFile({
        specVersion: "TY2026-REAL",
        year: 2026,
        employer: EMPLOYER,
        employees: [EMP],
      }),
    /not implemented by this builder/,
  );
});
