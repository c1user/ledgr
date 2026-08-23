import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";

// The app is bilingual with exact key parity by convention — a key present
// in one locale but not the other renders as a raw key in the UI. This
// test turns that convention into an invariant.
const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object"
      ? flatten(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );

describe("i18n locale parity", () => {
  it("en and es carry exactly the same keys", () => {
    const enKeys = new Set(flatten(en));
    const esKeys = new Set(flatten(es));
    const onlyEn = [...enKeys].filter((k) => !esKeys.has(k));
    const onlyEs = [...esKeys].filter((k) => !enKeys.has(k));
    expect(onlyEn).toEqual([]);
    expect(onlyEs).toEqual([]);
  });

  it("no locale value is empty", () => {
    const empty = (locale) =>
      flatten(locale).filter((k) => {
        const val = k.split(".").reduce((o, part) => o?.[part], locale);
        return typeof val === "string" && val.trim() === "";
      });
    expect(empty(en)).toEqual([]);
    expect(empty(es)).toEqual([]);
  });
});
