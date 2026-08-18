import { describe, it, expect } from "vitest";
import {
  resolveToolsets,
  TOOLSETS,
  DEFAULT_TOOLSETS,
  ALL_TOOLSETS,
} from "./toolsets.js";

describe("resolveToolsets", () => {
  it.each([undefined, "", "   ", ",,"])("falls back to the defaults for %o", (raw) => {
    expect([...resolveToolsets(raw)]).toEqual([...DEFAULT_TOOLSETS]);
  });

  it("registers everything for 'all'", () => {
    expect([...resolveToolsets(ALL_TOOLSETS)]).toEqual([...TOOLSETS]);
  });

  it("lets 'all' anywhere in the list win", () => {
    expect(resolveToolsets(`core,${ALL_TOOLSETS}`).size).toBe(TOOLSETS.length);
  });

  it("parses a comma-separated list, ignoring case and spacing", () => {
    expect([...resolveToolsets("  Core , REPORTING ,shopping ")]).toEqual([
      "core",
      "reporting",
      "shopping",
    ]);
  });

  it("de-duplicates repeated groups", () => {
    expect([...resolveToolsets("core,core,reporting")]).toEqual(["core", "reporting"]);
  });

  it("rejects an unknown group and names the valid ones", () => {
    expect(() => resolveToolsets("core,campaigns")).toThrow(/Unknown GOOGLE_ADS_TOOLSETS/);
    expect(() => resolveToolsets("core,campaigns")).toThrow(/campaigns/);
    expect(() => resolveToolsets("core,campaigns")).toThrow(/Valid groups/);
  });

  it("reports every unknown group at once, not just the first", () => {
    expect(() => resolveToolsets("nope,alsonope")).toThrow(/nope, alsonope/);
  });
});
