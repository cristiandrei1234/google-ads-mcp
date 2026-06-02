import { describe, it, expect } from "vitest";
import {
  normalizeCustomerId,
  escapeGaqlString,
  extractResourceId,
  normalizeNumericId,
  toResourceName,
} from "./resourceNames.js";

describe("normalizeCustomerId", () => {
  it("strips dashes", () => {
    expect(normalizeCustomerId("123-456-7890")).toBe("1234567890");
  });

  it("leaves a bare id unchanged", () => {
    expect(normalizeCustomerId("1234567890")).toBe("1234567890");
  });

  it("returns an empty string for an empty input", () => {
    expect(normalizeCustomerId("")).toBe("");
  });
});

describe("escapeGaqlString", () => {
  it("escapes backslashes and single quotes", () => {
    expect(escapeGaqlString("a'b")).toBe("a\\'b");
    expect(escapeGaqlString("a\\b")).toBe("a\\\\b");
  });

  it("escapes a backslash followed by a quote (backslash first)", () => {
    // \' -> backslash escaped to \\ then quote escaped to \'  => \\\'
    expect(escapeGaqlString("\\'")).toBe("\\\\\\'");
  });

  it("returns a plain string unchanged", () => {
    expect(escapeGaqlString("hello world")).toBe("hello world");
  });
});

describe("extractResourceId", () => {
  it("pulls the trailing id from a resource name", () => {
    expect(extractResourceId("customers/123/campaigns/456", "campaigns")).toBe("456");
  });

  it("falls back to the trimmed input when it is a bare id", () => {
    expect(extractResourceId("  789  ", "campaigns")).toBe("789");
  });

  it("falls back when the collection does not match", () => {
    expect(extractResourceId("customers/123/adGroups/456", "campaigns")).toBe(
      "customers/123/adGroups/456"
    );
  });

  it("returns an empty string for empty input (no match, trimmed empty)", () => {
    expect(extractResourceId("   ", "campaigns")).toBe("");
  });
});

describe("normalizeNumericId", () => {
  it("extracts and strips non-digits from a resource name", () => {
    expect(normalizeNumericId("customers/123/campaigns/4-5-6", "campaigns")).toBe("456");
  });

  it("returns a bare numeric id unchanged", () => {
    expect(normalizeNumericId("789", "campaigns")).toBe("789");
  });

  it("throws when the input contains no digits", () => {
    expect(() => normalizeNumericId("abc", "campaigns")).toThrow(
      /Invalid campaigns identifier: abc/
    );
  });

  it("throws for an empty extracted id", () => {
    expect(() => normalizeNumericId("---", "campaigns")).toThrow(/Invalid campaigns/);
  });
});

describe("toResourceName", () => {
  it("returns an already-qualified resource name unchanged", () => {
    expect(toResourceName("123", "customers/999/campaigns/1", "campaigns")).toBe(
      "customers/999/campaigns/1"
    );
  });

  it("builds a resource name from a customer id and a bare id", () => {
    expect(toResourceName("123-456-7890", "456", "campaigns")).toBe(
      "customers/1234567890/campaigns/456"
    );
  });

  it("normalizes a qualified id of a different collection (extracts numeric)", () => {
    expect(toResourceName("111", "campaigns/22", "campaigns")).toBe(
      "customers/111/campaigns/22"
    );
  });

  it("propagates the throw for a non-numeric id", () => {
    expect(() => toResourceName("111", "abc", "campaigns")).toThrow(/Invalid campaigns/);
  });
});
