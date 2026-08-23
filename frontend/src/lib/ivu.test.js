import { describe, it, expect } from "vitest";
import {
  IVU_DEFAULT_RATE,
  IVU_MUNI_RATE,
  deriveIvuPreset,
  autoMuniRate,
} from "./ivu";

describe("IVU presets (invoice form)", () => {
  it("recognizes the three named presets", () => {
    expect(deriveIvuPreset(11.5, 1)).toBe("standard");
    expect(deriveIvuPreset(4, 0)).toBe("reduced");
    expect(deriveIvuPreset(0, 0)).toBe("exempt");
  });

  it("anything else is custom — including near-misses", () => {
    expect(deriveIvuPreset(11.5, 0)).toBe("custom"); // combined w/o muni
    expect(deriveIvuPreset(4, 1)).toBe("custom");
    expect(deriveIvuPreset(7, 1)).toBe("custom");
  });

  it("mirrors the backend muni heuristic: >=5% includes the 1% municipal", () => {
    expect(autoMuniRate(11.5)).toBe(IVU_MUNI_RATE);
    expect(autoMuniRate(5)).toBe(IVU_MUNI_RATE);
    expect(autoMuniRate(4)).toBe(0);
    expect(autoMuniRate(0)).toBe(0);
  });

  it("constants stay in sync with the standard PR rates", () => {
    expect(IVU_DEFAULT_RATE).toBe(11.5);
    expect(IVU_MUNI_RATE).toBe(1);
  });
});
