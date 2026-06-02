import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/merchant-center/client.js", () => ({ getContentService: vi.fn() }));
vi.mock("../observability/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../config/env.js", () => ({ default: { MERCHANT_CENTER_ID: "" } }));

import { listProducts, getProduct, insertProduct, deleteProduct } from "./merchantCenter.js";
import { getContentService } from "../services/merchant-center/client.js";
import config from "../config/env.js";

function fakeService() {
  return {
    products: {
      list: vi.fn(async () => ({ data: { resources: [{ id: "p1" }] } })),
      get: vi.fn(async () => ({ data: { id: "p1" } })),
      insert: vi.fn(async () => ({ data: { id: "inserted" } })),
      delete: vi.fn(async () => ({})),
    },
  };
}

let service: ReturnType<typeof fakeService>;

beforeEach(() => {
  vi.clearAllMocks();
  service = fakeService();
  (getContentService as any).mockResolvedValue(service);
  (config as any).MERCHANT_CENTER_ID = "";
});

describe("merchantCenter.listProducts", () => {
  it("lists products with explicit merchantId and default maxResults", async () => {
    const res = await listProducts({ customerId: "1", merchantId: "M1" });
    expect(service.products.list).toHaveBeenCalledWith({ merchantId: "M1", maxResults: 10 });
    expect(res).toEqual([{ id: "p1" }]);
  });

  it("uses provided maxResults", async () => {
    await listProducts({ customerId: "1", merchantId: "M1", maxResults: 25 });
    expect(service.products.list).toHaveBeenCalledWith({ merchantId: "M1", maxResults: 25 });
  });

  it("falls back to config MERCHANT_CENTER_ID when merchantId empty", async () => {
    (config as any).MERCHANT_CENTER_ID = "ENVID";
    await listProducts({ customerId: "1", merchantId: "" });
    expect(service.products.list).toHaveBeenCalledWith({ merchantId: "ENVID", maxResults: 10 });
  });

  it("returns empty array when resources missing", async () => {
    service.products.list.mockResolvedValueOnce({ data: {} });
    const res = await listProducts({ customerId: "1", merchantId: "M1" });
    expect(res).toEqual([]);
  });

  it("throws when no merchantId available", async () => {
    await expect(listProducts({ customerId: "1", merchantId: "" })).rejects.toThrow(/Merchant Center ID is required/);
  });

  it("logs and rethrows when list fails", async () => {
    service.products.list.mockRejectedValueOnce(new Error("boom"));
    await expect(listProducts({ customerId: "1", merchantId: "M1" })).rejects.toThrow("boom");
  });
});

describe("merchantCenter.getProduct", () => {
  it("gets a product", async () => {
    const res = await getProduct({ customerId: "1", merchantId: "M1", productId: "online:en:US:sku" });
    expect(service.products.get).toHaveBeenCalledWith({ merchantId: "M1", productId: "online:en:US:sku" });
    expect(res).toEqual({ id: "p1" });
  });

  it("falls back to env merchantId", async () => {
    (config as any).MERCHANT_CENTER_ID = "ENVID";
    await getProduct({ customerId: "1", merchantId: "", productId: "x" });
    expect(service.products.get).toHaveBeenCalledWith({ merchantId: "ENVID", productId: "x" });
  });

  it("throws when no merchantId", async () => {
    await expect(getProduct({ customerId: "1", merchantId: "", productId: "x" })).rejects.toThrow(/required/);
  });

  it("rethrows on get failure", async () => {
    service.products.get.mockRejectedValueOnce(new Error("nope"));
    await expect(getProduct({ customerId: "1", merchantId: "M1", productId: "x" })).rejects.toThrow("nope");
  });
});

describe("merchantCenter.insertProduct", () => {
  const base = {
    customerId: "1",
    merchantId: "M1",
    offerId: "sku1",
    title: "T",
    description: "D",
    link: "http://x",
    imageLink: "http://img",
    contentLanguage: "en",
    targetCountry: "US",
    channel: "online" as const,
    availability: "in stock" as const,
    price: { value: "10.00", currency: "USD" },
    condition: "new" as const,
  };

  it("inserts a product including optional brand", async () => {
    const res = await insertProduct({ ...base, brand: "Acme" });
    expect(service.products.insert).toHaveBeenCalledWith({
      merchantId: "M1",
      requestBody: expect.objectContaining({ offerId: "sku1", brand: "Acme", price: { value: "10.00", currency: "USD" } }),
    });
    expect(res).toEqual({ id: "inserted" });
  });

  it("inserts without brand (undefined)", async () => {
    await insertProduct({ ...base });
    const body = (service.products.insert as any).mock.calls[0][0].requestBody;
    expect(body.brand).toBeUndefined();
  });

  it("falls back to env merchantId", async () => {
    (config as any).MERCHANT_CENTER_ID = "ENVID";
    await insertProduct({ ...base, merchantId: "" });
    expect((service.products.insert as any).mock.calls[0][0].merchantId).toBe("ENVID");
  });

  it("throws when no merchantId", async () => {
    await expect(insertProduct({ ...base, merchantId: "" })).rejects.toThrow(/required/);
  });

  it("rethrows on insert failure", async () => {
    service.products.insert.mockRejectedValueOnce(new Error("insfail"));
    await expect(insertProduct({ ...base })).rejects.toThrow("insfail");
  });
});

describe("merchantCenter.deleteProduct", () => {
  it("deletes a product", async () => {
    const res = await deleteProduct({ customerId: "1", merchantId: "M1", productId: "online:en:US:sku" });
    expect(service.products.delete).toHaveBeenCalledWith({ merchantId: "M1", productId: "online:en:US:sku" });
    expect(res).toEqual({ success: true, productId: "online:en:US:sku" });
  });

  it("falls back to env merchantId", async () => {
    (config as any).MERCHANT_CENTER_ID = "ENVID";
    await deleteProduct({ customerId: "1", merchantId: "", productId: "x" });
    expect((service.products.delete as any).mock.calls[0][0].merchantId).toBe("ENVID");
  });

  it("throws when no merchantId", async () => {
    await expect(deleteProduct({ customerId: "1", merchantId: "", productId: "x" })).rejects.toThrow(/required/);
  });

  it("rethrows on delete failure", async () => {
    service.products.delete.mockRejectedValueOnce(new Error("delfail"));
    await expect(deleteProduct({ customerId: "1", merchantId: "M1", productId: "x" })).rejects.toThrow("delfail");
  });
});
