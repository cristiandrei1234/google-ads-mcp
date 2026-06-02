import { describe, it, expect } from "vitest";
import { assertResourceBelongsToCustomer } from "./resourceGuard.js";

describe("assertResourceBelongsToCustomer", () => {
  it("accepts a resourceName under the same customer (dashes ignored)", () => {
    expect(() =>
      assertResourceBelongsToCustomer("customers/1112223333/offlineUserDataJobs/55", "111-222-3333")
    ).not.toThrow();
  });

  it("rejects a resourceName under a different customer", () => {
    expect(() =>
      assertResourceBelongsToCustomer("customers/9999999999/offlineUserDataJobs/55", "1112223333")
    ).toThrow(/does not belong/i);
  });

  it("rejects a malformed resourceName", () => {
    expect(() => assertResourceBelongsToCustomer("not-a-resource", "1112223333")).toThrow();
    expect(() => assertResourceBelongsToCustomer("customers//x", "1112223333")).toThrow();
  });
});
