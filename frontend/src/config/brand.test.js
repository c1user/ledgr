import { describe, it, expect } from "vitest";
import BRAND from "./brand";

describe("brand", () => {
  it("exposes the product name", () => {
    expect(BRAND.name).toBe("Abaco");
  });

  it("name is a non-empty string", () => {
    expect(typeof BRAND.name).toBe("string");
    expect(BRAND.name.length).toBeGreaterThan(0);
  });
});
