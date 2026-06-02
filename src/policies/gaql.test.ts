import { describe, it, expect } from "vitest";
import { assertSafeGaqlFragment } from "./gaql.js";

describe("assertSafeGaqlFragment", () => {
  it("allows undefined and normal clause bodies", () => {
    expect(() => assertSafeGaqlFragment(undefined, "where")).not.toThrow();
    expect(() => assertSafeGaqlFragment("metrics.clicks > 100 AND campaign.status = 'ENABLED'", "where")).not.toThrow();
    expect(() => assertSafeGaqlFragment("metrics.cost_micros DESC", "orderBy")).not.toThrow();
  });

  it("rejects statement separators and comments", () => {
    expect(() => assertSafeGaqlFragment("1=1; DROP", "where")).toThrow(/';'/);
    expect(() => assertSafeGaqlFragment("x -- comment", "where")).toThrow();
    expect(() => assertSafeGaqlFragment("x /* c */", "where")).toThrow();
  });

  it("rejects smuggled statement keywords", () => {
    expect(() => assertSafeGaqlFragment("1=1 UNION SELECT", "where")).toThrow(/keyword/i);
    expect(() => assertSafeGaqlFragment("a FROM customer", "orderBy")).toThrow(/keyword/i);
  });
});
