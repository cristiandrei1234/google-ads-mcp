import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));

import { runQuery } from "./runQuery.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runQuery", () => {
  it("queries the customer and returns rows (no userId)", async () => {
    const customer = fakeCustomer([{ a: 1 }]);
    (getCustomer as any).mockResolvedValue(customer);
    const res = await runQuery({ customerId: "123", query: "SELECT x" });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
    expect(customer.query).toHaveBeenCalledWith("SELECT x");
    expect(res).toEqual([{ a: 1 }]);
  });

  it("passes userId through to getCustomer (multi-tenant branch)", async () => {
    const customer = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(customer);
    await runQuery({ customerId: "123", query: "SELECT y", userId: "u-1" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u-1");
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
