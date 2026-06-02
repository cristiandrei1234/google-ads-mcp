import { describe, it, expect } from "vitest";
import { BaseSchema, LimitedListSchema, chunk } from "./_schemas.js";

describe("_schemas", () => {
  describe("BaseSchema", () => {
    it("accepts a customerId and optional userId", () => {
      expect(BaseSchema.parse({ customerId: "1", userId: "u" })).toEqual({ customerId: "1", userId: "u" });
    });

    it("makes userId optional", () => {
      expect(BaseSchema.parse({ customerId: "1" })).toEqual({ customerId: "1" });
    });

    it("rejects a missing customerId", () => {
      expect(() => BaseSchema.parse({})).toThrow();
    });
  });

  describe("LimitedListSchema", () => {
    it("defaults limit to 100", () => {
      expect(LimitedListSchema.parse({ customerId: "1" }).limit).toBe(100);
    });

    it("accepts a valid limit", () => {
      expect(LimitedListSchema.parse({ customerId: "1", limit: 5 }).limit).toBe(5);
    });

    it("rejects a limit below 1", () => {
      expect(() => LimitedListSchema.parse({ customerId: "1", limit: 0 })).toThrow();
    });

    it("rejects a limit above 1000", () => {
      expect(() => LimitedListSchema.parse({ customerId: "1", limit: 1001 })).toThrow();
    });

    it("rejects a non-integer limit", () => {
      expect(() => LimitedListSchema.parse({ customerId: "1", limit: 1.5 })).toThrow();
    });
  });

  describe("chunk", () => {
    it("splits into consecutive sub-arrays of at most size", () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it("returns a single chunk when size exceeds length", () => {
      expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
    });

    it("returns an empty array for empty input", () => {
      expect(chunk([], 3)).toEqual([]);
    });

    it("splits evenly when divisible", () => {
      expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    });
  });
});
