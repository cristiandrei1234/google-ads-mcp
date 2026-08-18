import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));

import { runQuery } from "./runQuery.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";
import { DEFAULT_QUERY_LIMIT } from "../policies/gaql.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runQuery", () => {
  it("queries the customer and returns rows", async () => {
    const customer = fakeCustomer([{ a: 1 }]);
    (getCustomer as any).mockResolvedValue(customer);
    const res = await runQuery({ customerId: "123", query: "SELECT x LIMIT 3" });
    expect(getCustomer).toHaveBeenCalledWith("123");
    expect(customer.query).toHaveBeenCalledWith("SELECT x LIMIT 3");
    expect(res).toEqual([{ a: 1 }]);
  });

  it("adds a default LIMIT to a statement that has none", async () => {
    const customer = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(customer);
    await runQuery({ customerId: "123", query: "SELECT y FROM campaign" });
    expect(customer.query).toHaveBeenCalledWith(`SELECT y FROM campaign LIMIT ${DEFAULT_QUERY_LIMIT}`);
  });

  it("rejects a statement that smuggles a second statement or a comment", async () => {
    await expect(
      runQuery({ customerId: "1", query: "SELECT a FROM campaign; DROP TABLE x" })
    ).rejects.toThrow(/Invalid GAQL query/);
    await expect(
      runQuery({ customerId: "1", query: "SELECT a FROM campaign -- comment" })
    ).rejects.toThrow(/Invalid GAQL query/);
    expect(getCustomer).not.toHaveBeenCalled();
  });

  it("rethrows when getCustomer rejects", async () => {
    (getCustomer as any).mockRejectedValue(new Error("no client"));
    await expect(runQuery({ customerId: "1", query: "Q" })).rejects.toThrow("no client");
  });

  it("rethrows when the query fails", async () => {
    const customer = fakeCustomer([]);
    customer.query.mockRejectedValue(new Error("bad gaql"));
    (getCustomer as any).mockResolvedValue(customer);
    await expect(runQuery({ customerId: "1", query: "Q" })).rejects.toThrow("bad gaql");
  });
});
