import { describe, it, expect } from "vitest";
import {
  assertSafeGaqlFragment,
  assertSafeGaqlStatement,
  withDefaultLimit,
  DEFAULT_QUERY_LIMIT,
} from "./gaql.js";

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

describe("assertSafeGaqlStatement", () => {
  it("accepts a normal statement, keywords included", () => {
    expect(() =>
      assertSafeGaqlStatement("SELECT campaign.id FROM campaign WHERE campaign.status = ENABLED")
    ).not.toThrow();
  });

  it.each([
    ["a statement separator", "SELECT a FROM b; SELECT c FROM d"],
    ["a line comment", "SELECT a FROM b -- rest"],
    ["a block comment opener", "SELECT a /* hidden */ FROM b"],
  ])("rejects %s", (_label, query) => {
    expect(() => assertSafeGaqlStatement(query)).toThrow(/Invalid GAQL query/);
  });
});

describe("withDefaultLimit", () => {
  it("appends a LIMIT when the statement has none", () => {
    expect(withDefaultLimit("SELECT campaign.id FROM campaign")).toBe(
      `SELECT campaign.id FROM campaign LIMIT ${DEFAULT_QUERY_LIMIT}`
    );
  });

  it("honors an explicit limit argument", () => {
    expect(withDefaultLimit("SELECT a FROM b", 5)).toBe("SELECT a FROM b LIMIT 5");
  });

  it("leaves an existing LIMIT alone, whatever its case", () => {
    expect(withDefaultLimit("SELECT a FROM b LIMIT 10")).toBe("SELECT a FROM b LIMIT 10");
    expect(withDefaultLimit("SELECT a FROM b limit 10")).toBe("SELECT a FROM b limit 10");
  });

  it("does not mistake a field name ending in 'limit' for the clause", () => {
    expect(withDefaultLimit("SELECT budget.sublimit FROM b")).toBe(
      `SELECT budget.sublimit FROM b LIMIT ${DEFAULT_QUERY_LIMIT}`
    );
  });

  it("keeps PARAMETERS last, where the grammar requires it", () => {
    expect(withDefaultLimit("SELECT a FROM b PARAMETERS include_drafts=true")).toBe(
      `SELECT a FROM b LIMIT ${DEFAULT_QUERY_LIMIT} PARAMETERS include_drafts=true`
    );
  });

  it("trims surrounding whitespace before appending", () => {
    expect(withDefaultLimit("  SELECT a FROM b  ", 7)).toBe("SELECT a FROM b LIMIT 7");
  });
});
