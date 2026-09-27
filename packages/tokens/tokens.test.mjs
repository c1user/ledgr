// Drift guard: brand.js literals must exist in tokens.css, and the light and
// dark themes must define exactly the same variables. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BRAND, HEX } from "./brand.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "tokens.css"), "utf8").toLowerCase();

const block = (selector) => {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, "missing block " + selector);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
};
const names = (b) =>
  [...b.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]).sort();

test("light and dark themes define the same variables", () => {
  const light = names(block(":root"));
  const dark = names(block('[data-theme="dark"]'));
  // --row-y* are density knobs, light-only by design.
  const layoutOnly = new Set(["row-y", "row-y-sm"]);
  assert.deepEqual(
    light.filter((n) => !layoutOnly.has(n)),
    dark.filter((n) => !layoutOnly.has(n)),
  );
  assert.ok(light.length > 20);
});

test("every HEX literal in brand.js appears in tokens.css", () => {
  for (const [key, hex] of Object.entries(HEX)) {
    assert.match(hex, /^#[0-9a-f]{6}$/i, key + " must be a 6-digit hex");
    assert.ok(
      css.includes(hex.toLowerCase()),
      key + " (" + hex + ") not found in tokens.css",
    );
  }
});

test("brand names are set", () => {
  assert.equal(BRAND.name, "Abaco");
  assert.ok(BRAND.mobileName.length > 0);
  assert.match(BRAND.appId, /^[a-z]+(\.[a-z0-9]+)+$/);
});
