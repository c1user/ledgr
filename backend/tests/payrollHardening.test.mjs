import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeLine } from "../src/services/payrollEngine.js";
import { todayPR, toIso } from "../src/services/prDates.js";
import { sanitize } from "../src/middleware/auditLog.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ── 6.1 Golden files: swapping expectations is a data-only change ──

const golden = JSON.parse(
  fs.readFileSync(path.join(DIR, "fixtures/goldenPayroll.json"), "utf8"),
);

for (const c of golden.cases) {
  test(`golden: ${c.name}`, () => {
    const r = computeLine({ ...c.input, rules: golden.rules });
    const items = {};
    for (const it of r.items) items[it.code] = it.amount_cents;
    assert.deepEqual(
      {
        grossCents: r.grossCents,
        employeeDeductionsCents: r.employeeDeductionsCents,
        employerContributionsCents: r.employerContributionsCents,
        netCents: r.netCents,
        deltas: r.deltas,
        items,
        warnings: r.warnings,
      },
      c.expected,
    );
  });
}

// ── 6.2 Property tests (seeded PRNG — deterministic) ─────────

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomInput(rand) {
  const hourly = rand() < 0.6;
  const days = [];
  const dayCount = Math.floor(rand() * 14);
  for (let d = 0; d < dayCount; d++) {
    days.push({
      date: `2026-08-${String(d + 1).padStart(2, "0")}`,
      hours: Math.round(rand() * 12 * 4) / 4,
      mealBreakMissed: rand() < 0.1,
    });
  }
  const frequencies = ["weekly", "biweekly", "semimonthly", "monthly"];
  return {
    employee: {
      id: "prop",
      payType: hourly ? "hourly" : "salary",
      payRateCents: hourly
        ? 900 + Math.floor(rand() * 4000)
        : 2000000 + Math.floor(rand() * 15000000),
      isChauffeur: rand() < 0.2,
      hireDate: rand() < 0.5 ? "2015-03-01" : "2022-03-01",
      elections: {
        exemption_status: ["none", "complete", "half_joint"][
          Math.floor(rand() * 3)
        ],
        allowances: Math.floor(rand() * 4),
        additional_withholding_cents: Math.floor(rand() * 3000),
      },
    },
    period: { frequency: frequencies[Math.floor(rand() * 4)] },
    dailyHours: days.filter((d) => d.hours > 0),
    rules: golden.rules,
    ytd: {
      grossCents: Math.floor(rand() * 20000000),
      ssWagesCents: Math.floor(rand() * 18000000),
      medicareWagesCents: Math.floor(rand() * 21000000),
      sinotWagesCents: Math.floor(rand() * 900000),
      sutaWagesCents: Math.floor(rand() * 1050000),
    },
    employerProfile: {
      sizeBand: ["le_15", "gt_15", "le_20", "gt_20", null][
        Math.floor(rand() * 5)
      ],
    },
  };
}

test("property: invariants hold across 300 randomized inputs", () => {
  const rand = lcg(20260809);
  let computed = 0;
  for (let i = 0; i < 300; i++) {
    const input = randomInput(rand);
    let r;
    try {
      r = computeLine(input);
    } catch (err) {
      // Only the documented refusal is acceptable: deductions > gross
      // (tiny gross + large fixed additional withholding).
      assert.match(err.message, /exceed gross/);
      continue;
    }
    computed++;

    const sum = (type) =>
      r.items
        .filter((it) => it.item_type === type)
        .reduce((a, it) => a + it.amount_cents, 0);

    assert.equal(sum("earning"), r.grossCents);
    assert.equal(sum("employee_deduction"), r.employeeDeductionsCents);
    assert.equal(sum("employer_contribution"), r.employerContributionsCents);
    assert.equal(r.netCents + r.employeeDeductionsCents, r.grossCents);
    for (const it of r.items) {
      assert.ok(Number.isSafeInteger(it.amount_cents) && it.amount_cents >= 0);
    }
    for (const key of [
      "ssTaxableCents",
      "medicareTaxableCents",
      "sinotTaxableCents",
      "sutaTaxableCents",
    ]) {
      assert.ok(r.deltas[key] >= 0 && r.deltas[key] <= r.grossCents);
    }
    // Reproducibility (§1.3): same input, identical output.
    assert.deepEqual(computeLine(input), r);
  }
  assert.ok(computed > 200, `only ${computed} inputs computed`);
});

test("property: SS withholding stops exactly at the wage base across sequential periods", () => {
  const base = golden.rules.social_security.payload.wage_base_cents;
  const input = {
    employee: {
      id: "cap",
      payType: "salary",
      payRateCents: 7800000, // $78k/yr → crosses the placeholder base mid-year
      isChauffeur: false,
      hireDate: "2020-01-01",
      elections: { exemption_status: "none", allowances: 0 },
    },
    period: { frequency: "monthly" },
    dailyHours: [],
    rules: golden.rules,
    employerProfile: { sizeBand: "le_20" },
  };

  const ytd = {
    grossCents: 0,
    ssWagesCents: 0,
    medicareWagesCents: 0,
    sinotWagesCents: 0,
    sutaWagesCents: 0,
  };
  let ssTaxableTotal = 0;
  let grossTotal = 0;
  const monthly = [];
  for (let m = 0; m < 12; m++) {
    const r = computeLine({ ...input, ytd: { ...ytd } });
    ssTaxableTotal += r.deltas.ssTaxableCents;
    grossTotal += r.grossCents;
    monthly.push(ytd.ssWagesCents);
    // YTD monotonicity: accumulators only grow within the year.
    ytd.grossCents += r.grossCents;
    ytd.ssWagesCents += r.deltas.ssTaxableCents;
    ytd.medicareWagesCents += r.deltas.medicareTaxableCents;
    ytd.sinotWagesCents += r.deltas.sinotTaxableCents;
    ytd.sutaWagesCents += r.deltas.sutaTaxableCents;
  }
  assert.equal(ssTaxableTotal, Math.min(grossTotal, base));
  for (let m = 1; m < 12; m++) {
    assert.ok(monthly[m] >= monthly[m - 1], "YTD must be monotonic");
  }
});

// ── 6.3 Puerto Rico dates ────────────────────────────────────

test("todayPR returns the PR calendar day, not the UTC day", () => {
  assert.match(todayPR(), /^\d{4}-\d{2}-\d{2}$/);
  const expected = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Puerto_Rico",
  });
  assert.equal(todayPR(), expected);
});

test("toIso survives pg Date objects (the String(Date) trap)", () => {
  // node-postgres parses DATE columns as LOCAL midnight — model that.
  // (A UTC-midnight fixture would misrepresent pg and reintroduce the
  // east-of-UTC off-by-one toIso now guards against.)
  assert.equal(toIso(new Date(2026, 7, 14)), "2026-08-14");
  assert.equal(toIso("2026-08-14"), "2026-08-14");
  assert.equal(toIso("2026-08-14T12:00:00Z"), "2026-08-14");
});

// ── 6.4 Audit snapshot scrub ─────────────────────────────────

test("sanitize strips every SSN and credential key from audit snapshots", () => {
  const body = {
    name: "Carmen",
    ssn: "123-45-6789",
    ssnLast4: "6789",
    ssn_encrypted: "blob",
    password: "x",
    reset_token: "y",
    payRate: 18.5,
  };
  const clean = sanitize(body);
  assert.deepEqual(clean, { name: "Carmen", payRate: 18.5 });
  assert.ok(!JSON.stringify(clean).match(/6789|123-45/));

  // Delete snapshots are raw employee rows — same guarantee.
  const row = {
    id: "e1",
    name: "C",
    ssn_last4: "6789",
    ssn_encrypted: "iv.t.c",
  };
  assert.deepEqual(sanitize(row), { id: "e1", name: "C" });
});
