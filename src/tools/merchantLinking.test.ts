import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../observability/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { linkMerchantCenter, listMerchantCenterLinks, unlinkMerchantCenter } from "./merchantLinking.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

function makeCustomer(queryRows: unknown[] = []) {
  const c: any = fakeCustomer(queryRows);
  c.productLinks = {
    createProductLink: vi.fn(async () => ({ resource_name: "customers/1/productLinks/5" })),
    removeProductLink: vi.fn(async () => ({ removed: true })),
  };
  return c;
}

let customer: ReturnType<typeof makeCustomer>;

beforeEach(() => {
  vi.clearAllMocks();
  customer = makeCustomer();
  (getCustomer as any).mockResolvedValue(customer);
  delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
});

afterEach(() => {
  delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
});

describe("linkMerchantCenter", () => {
  it("creates a product link, stripping dashes", async () => {
    const res = await linkMerchantCenter({ customerId: "1", merchantCenterId: "123-456" });
    expect(customer.productLinks.createProductLink).toHaveBeenCalledWith({
      customer_id: "1",
      product_link: { merchant_center: { merchant_center_id: 123456 } },
    });
    expect(res).toEqual({ resource_name: "customers/1/productLinks/5" });
  });

  it("passes userId to getCustomer", async () => {
    await linkMerchantCenter({ customerId: "1", merchantCenterId: "100", userId: "u1" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u1");
  });

  it("throws on non-numeric merchantCenterId", async () => {
    await expect(linkMerchantCenter({ customerId: "1", merchantCenterId: "abc" })).rejects.toThrow(/Expected numeric ID/);
  });

  it("rethrows when createProductLink fails", async () => {
    customer.productLinks.createProductLink.mockRejectedValueOnce(new Error("linkfail"));
    await expect(linkMerchantCenter({ customerId: "1", merchantCenterId: "100" })).rejects.toThrow("linkfail");
  });
});

describe("listMerchantCenterLinks", () => {
  it("queries product_link", async () => {
    customer.query.mockResolvedValueOnce([{ product_link: { product_link_id: "7" } }]);
    const res = await listMerchantCenterLinks({ customerId: "1" });
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("FROM product_link");
    expect(q).toContain("product_link.type = 'MERCHANT_CENTER'");
    expect(res).toEqual([{ product_link: { product_link_id: "7" } }]);
  });
});

describe("unlinkMerchantCenter", () => {
  it("finds the link and removes it (validate_only false by default)", async () => {
    customer.query.mockResolvedValueOnce([{ product_link: { resource_name: "customers/1/productLinks/9" } }]);
    const res = await unlinkMerchantCenter({ customerId: "1", merchantCenterId: "12-34" });
    expect(customer.query.mock.calls[0][0]).toContain("merchant_center_id = 1234");
    expect(customer.productLinks.removeProductLink).toHaveBeenCalledWith({
      customer_id: "1",
      resource_name: "customers/1/productLinks/9",
      validate_only: false,
    });
    expect(res).toEqual({ removed: true });
  });

  it("honors GOOGLE_ADS_VALIDATE_ONLY env", async () => {
    process.env.GOOGLE_ADS_VALIDATE_ONLY = "TRUE";
    customer.query.mockResolvedValueOnce([{ product_link: { resource_name: "rn" } }]);
    await unlinkMerchantCenter({ customerId: "1", merchantCenterId: "1234" });
    expect((customer.productLinks.removeProductLink as any).mock.calls[0][0].validate_only).toBe(true);
  });

  it("throws on non-numeric merchantCenterId", async () => {
    await expect(unlinkMerchantCenter({ customerId: "1", merchantCenterId: "xx" })).rejects.toThrow(/Expected numeric ID/);
  });

  it("throws when no link found (empty result)", async () => {
    customer.query.mockResolvedValueOnce([]);
    await expect(unlinkMerchantCenter({ customerId: "1", merchantCenterId: "1234" })).rejects.toThrow(/No Merchant Center link found/);
  });

  it("throws when link row lacks resource_name", async () => {
    customer.query.mockResolvedValueOnce([{ product_link: {} }]);
    await expect(unlinkMerchantCenter({ customerId: "1", merchantCenterId: "1234" })).rejects.toThrow(/No Merchant Center link found/);
  });

  it("rethrows when removeProductLink fails", async () => {
    customer.query.mockResolvedValueOnce([{ product_link: { resource_name: "rn" } }]);
    customer.productLinks.removeProductLink.mockRejectedValueOnce(new Error("rmfail"));
    await expect(unlinkMerchantCenter({ customerId: "1", merchantCenterId: "1234" })).rejects.toThrow("rmfail");
  });
});
