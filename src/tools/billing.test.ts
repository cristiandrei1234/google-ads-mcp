import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));

import { listInvoices, listAccountBudgets, listBillingSetups } from "./billing.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

function customerWithInvoices(invoicesImpl?: () => any) {
  const c: any = fakeCustomer([{ row: 1 }]);
  c.invoices = {
    listInvoices: vi.fn(invoicesImpl ?? (async () => ({ invoices: [] }))),
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listInvoices", () => {
  it("calls invoices.listInvoices with the built request", async () => {
    const c = customerWithInvoices();
    (getCustomer as any).mockResolvedValue(c);
    const res = await listInvoices({
      customerId: "1",
      billingSetupId: "bs-9",
      issueYear: "2026",
      issueMonth: "MARCH",
    });
    expect(getCustomer).toHaveBeenCalledWith("1", undefined);
    expect(c.invoices.listInvoices).toHaveBeenCalledWith({
      customer_id: "1",
      billing_setup: "customers/1/billingSetups/bs-9",
      issue_year: "2026",
      issue_month: "MARCH",
    });
    expect(res).toEqual({ invoices: [] });
  });

  it("rethrows on failure", async () => {
    const c = customerWithInvoices(async () => {
      throw new Error("invoice boom");
    });
    (getCustomer as any).mockResolvedValue(c);
    await expect(
      listInvoices({ customerId: "1", billingSetupId: "b", issueYear: "2026", issueMonth: "JUNE", userId: "u" })
    ).rejects.toThrow("invoice boom");
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
  });
});

describe("listAccountBudgets", () => {
  it("queries account_budget with the default limit", async () => {
    const c = fakeCustomer([{ b: 1 }]);
    (getCustomer as any).mockResolvedValue(c);
    const res = await listAccountBudgets({ customerId: "1", limit: 50 });
    expect(c.query.mock.calls[0][0]).toContain("FROM account_budget");
    expect(c.query.mock.calls[0][0]).toContain("LIMIT 50");
    expect(res).toEqual([{ b: 1 }]);
  });

  it("honors a custom limit and userId", async () => {
    const c = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(c);
    await listAccountBudgets({ customerId: "1", limit: 9, userId: "u" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
    expect(c.query.mock.calls[0][0]).toContain("LIMIT 9");
  });
});

describe("listBillingSetups", () => {
  it("queries billing_setup", async () => {
    const c = fakeCustomer([{ s: 1 }]);
    (getCustomer as any).mockResolvedValue(c);
    const res = await listBillingSetups({ customerId: "1", userId: "u" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
    expect(c.query.mock.calls[0][0]).toContain("FROM billing_setup");
    expect(res).toEqual([{ s: 1 }]);
  });
});
