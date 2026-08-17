import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ROADMAP-V5 Phase 3.1 / spec §1.4 — floats are forbidden in payroll
 * money paths. Every monetary value is integer cents; services/money.js
 * is the ONLY sanctioned dollars↔cents boundary (and is exempt below).
 *
 * The scan strips comments, then fails on:
 *  - parseFloat / Number.parseFloat
 *  - .toFixed(
 *  - decimal number literals (e.g. 0.062, 1.5) — every rate must come
 *    from a rule payload, never a literal in engine/service code.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCANNED = [
  "src/services/payrollEngine.js",
  "src/services/payrollRunV2.js",
  "src/routes/payrollV2.js",
  "src/routes/payrollTime.js",
];

const BANNED = [
  [/\bparseFloat\s*\(/, "parseFloat"],
  [/\bNumber\.parseFloat\b/, "Number.parseFloat"],
  [/\.toFixed\s*\(/, ".toFixed("],
  [/(?<![\w.])\d+\.\d+/, "decimal literal"],
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

for (const rel of SCANNED) {
  test(`cents discipline: ${rel} contains no float-style money code`, () => {
    const source = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    const offenses = [];
    for (const [re, label] of BANNED) {
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        if (re.test(line))
          offenses.push(`${label} at line ~${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenses, [], offenses.join("\n"));
  });
}
