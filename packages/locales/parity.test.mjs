// The apps are bilingual with exact key parity by convention — a key present
// in one locale but not the other renders as a raw key in the UI. This test
// turns that convention into an invariant for every consumer (web, mobile,
// backend PDFs). Run: npm test  (node:test, no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (lang) =>
  JSON.parse(readFileSync(path.join(here, `${lang}.json`), "utf8"));
const en = load("en");
const es = load("es");

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object"
      ? flatten(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );

test("en and es carry exactly the same keys", () => {
  const enKeys = new Set(flatten(en));
  const esKeys = new Set(flatten(es));
  const onlyEn = [...enKeys].filter((k) => !esKeys.has(k));
  const onlyEs = [...esKeys].filter((k) => !enKeys.has(k));
  assert.deepEqual(onlyEn, []);
  assert.deepEqual(onlyEs, []);
  assert.ok(enKeys.size > 1000, "sanity: the locale is not empty");
});

test("no locale value is empty", () => {
  const empty = (locale) =>
    flatten(locale).filter((k) => {
      const val = k.split(".").reduce((o, part) => o?.[part], locale);
      return typeof val === "string" && val.trim() === "";
    });
  assert.deepEqual(empty(en), []);
  assert.deepEqual(empty(es), []);
});

test("the chart-of-accounts name keys the backend seeds exist in both", () => {
  // coaSeed.js stores i18n keys like coa.accounts.sales_revenue on system
  // accounts; both apps and the PDF renderer resolve them from here.
  assert.ok(en.coa && en.coa.accounts, "en.coa.accounts missing");
  assert.ok(es.coa && es.coa.accounts, "es.coa.accounts missing");
  assert.deepEqual(
    Object.keys(en.coa.accounts).sort(),
    Object.keys(es.coa.accounts).sort(),
  );
});
