import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveRules,
  snapshotRuleIds,
  preflightRun,
  SANDBOX_WATERMARK,
  CORE_RUN_RULE_TYPES,
} from "../src/services/payrollRules.js";
import { PAYROLL_RULES_TEMPLATE } from "../src/services/payrollRulesSeed.js";

const BIZ = "00000000-0000-0000-0000-000000000001";

// Fake db routing on SQL shape: mode lookup vs rule resolution.
function fakeDb({ mode = "sandbox", rules = [] } = {}) {
  return {
    query: async (sql) => {
      if (sql.includes("payroll_mode")) {
        return { rows: [{ payroll_mode: mode }] };
      }
      if (sql.includes("FROM payroll_rules")) {
        return { rows: rules };
      }
      throw new Error(`Unexpected query in fake db: ${sql}`);
    },
  };
}

const rule = (type, status = "UNVERIFIED", extra = {}) => ({
  id: `id-${type}`,
  rule_type: type,
  jurisdiction: "PR",
  verification_status: status,
  source_citation: `citation for ${type}`,
  payload: {},
  ...extra,
});

const allCoreRules = (status) =>
  CORE_RUN_RULE_TYPES.map((t) => rule(t, status));

// ── resolution ───────────────────────────────────────────────

test("resolveRules maps rows by rule_type", async () => {
  const db = fakeDb({ rules: [rule("sinot"), rule("suta")] });
  const resolved = await resolveRules(db, BIZ, "2026-06-15");
  assert.deepEqual(Object.keys(resolved).sort(), ["sinot", "suta"]);
  assert.equal(resolved.sinot.id, "id-sinot");
});

test("snapshotRuleIds captures rule_type -> id", () => {
  const snapshot = snapshotRuleIds({
    sinot: rule("sinot"),
    suta: rule("suta"),
  });
  assert.deepEqual(snapshot, { sinot: "id-sinot", suta: "id-suta" });
});

// ── preflight gating ─────────────────────────────────────────

test("sandbox mode always allows the run but demands the watermark", async () => {
  const db = fakeDb({ mode: "sandbox", rules: allCoreRules("UNVERIFIED") });
  const result = await preflightRun(db, BIZ, "2026-06-15");
  assert.equal(result.ok, true);
  assert.equal(result.watermark, true);
  // Blockers are still reported so the UI can show what's missing.
  assert.equal(result.blockers.length, CORE_RUN_RULE_TYPES.length);
});

test("production mode hard-blocks on UNVERIFIED rules, listing each one", async () => {
  const rules = allCoreRules("VERIFIED");
  rules[0].verification_status = "UNVERIFIED";
  rules[1].verification_status = "UNVERIFIED";
  const db = fakeDb({ mode: "production", rules });

  const result = await preflightRun(db, BIZ, "2026-06-15");
  assert.equal(result.ok, false);
  assert.equal(result.watermark, false);
  assert.equal(result.blockers.length, 2);
  assert.equal(result.blockers[0].reason, "UNVERIFIED");
  assert.ok(result.blockers[0].rule_type);
  assert.ok(result.blockers[0].source_citation);
});

test("production mode blocks on MISSING rules too", async () => {
  const rules = allCoreRules("VERIFIED").filter(
    (r) => r.rule_type !== "overtime",
  );
  const db = fakeDb({ mode: "production", rules });

  const result = await preflightRun(db, BIZ, "2026-06-15");
  assert.equal(result.ok, false);
  const missing = result.blockers.find((b) => b.reason === "MISSING");
  assert.equal(missing.rule_type, "overtime");
});

test("production mode passes when every consumed rule is VERIFIED", async () => {
  const db = fakeDb({ mode: "production", rules: allCoreRules("VERIFIED") });
  const result = await preflightRun(db, BIZ, "2026-06-15");
  assert.equal(result.ok, true);
  assert.equal(result.watermark, false);
  assert.equal(result.blockers.length, 0);
  // Snapshot covers everything the run resolved.
  assert.equal(Object.keys(result.snapshot).length, CORE_RUN_RULE_TYPES.length);
});

test("preflight accepts a per-run rule-type list", async () => {
  const db = fakeDb({
    mode: "production",
    rules: [rule("sinot", "VERIFIED")],
  });
  const result = await preflightRun(db, BIZ, "2026-06-15", ["sinot"]);
  assert.equal(result.ok, true);
});

test("watermark text is exact", () => {
  assert.equal(SANDBOX_WATERMARK, "CÁLCULO NO VERIFICADO — SOLO PRUEBAS");
});

// ── seed template invariants ─────────────────────────────────

test("every template rule is a placeholder and can never self-verify", () => {
  assert.ok(PAYROLL_RULES_TEMPLATE.length >= 15);
  for (const r of PAYROLL_RULES_TEMPLATE) {
    assert.ok(r.rule_type, "rule_type required");
    // PLACEHOLDER = values are guesses; PENDING VERIFY = transcribed from
    // the named official source but not yet human-verified in the rules
    // admin. Either way the rule must announce it needs verification.
    assert.match(
      r.source_citation,
      /^(PLACEHOLDER|PENDING VERIFY)\b/,
      `${r.rule_type}: seed citations must be marked PLACEHOLDER or PENDING VERIFY`,
    );
    assert.equal(typeof r.payload, "object");
    // The template must never carry a verification status — rows rely on
    // the column default (UNVERIFIED) and only a human changes it.
    assert.equal(r.verification_status, undefined);
    assert.equal(r.verified_by, undefined);
    assert.equal(r.verified_at, undefined);
  }
});

test("core run rule types all exist in the seed template", () => {
  const seeded = new Set(PAYROLL_RULES_TEMPLATE.map((r) => r.rule_type));
  for (const type of CORE_RUN_RULE_TYPES) {
    assert.ok(seeded.has(type), `missing seed for ${type}`);
  }
});

test("template money fields are integer cents", () => {
  // Recursively assert every *_cents field holds an integer (or null).
  const check = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = `${path}.${k}`;
      if (v && typeof v === "object") check(v, p);
      else if (k.endsWith("_cents") && v !== null) {
        assert.ok(Number.isInteger(v), `${p} must be integer cents, got ${v}`);
      }
    }
  };
  for (const r of PAYROLL_RULES_TEMPLATE) {
    check(r.payload, r.rule_type);
  }
});
