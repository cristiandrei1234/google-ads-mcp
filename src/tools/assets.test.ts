import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("axios", () => ({ default: { get: vi.fn() } }));
vi.mock("../observability/logger.js", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { createTextAsset, createImageAsset, listAssets } from "./assets.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import axios from "axios";
import logger from "../observability/logger.js";
import { fakeCustomer } from "../test/harness.js";

let customer: ReturnType<typeof fakeCustomer>;

beforeEach(() => {
  vi.clearAllMocks();
  customer = fakeCustomer([{ asset: { id: "1" } }]);
  (getCustomer as any).mockResolvedValue(customer);
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("createTextAsset", () => {
  it("builds a TEXT asset create operation with name", async () => {
    await createTextAsset({ customerId: "1", text: "Hello", name: "MyAsset", userId: "u1" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u1");
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.asset_operation.create).toMatchObject({
      type: "TEXT",
      text_asset: { text: "Hello" },
      name: "MyAsset",
    });
  });

  it("works with name undefined", async () => {
    await createTextAsset({ customerId: "1", text: "Hi" });
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.asset_operation.create.name).toBeUndefined();
    expect(op.asset_operation.create.text_asset.text).toBe("Hi");
  });

  it("returns the mutation result", async () => {
    const res = await createTextAsset({ customerId: "1", text: "Hi" });
    expect(res).toEqual({ results: [{ resource_name: "rn" }] });
  });
});

describe("createImageAsset", () => {
  it("fetches the image, base64-encodes it and creates an IMAGE asset", async () => {
    (axios as any).get.mockResolvedValue({ data: Buffer.from("imgbytes") });
    await createImageAsset({ customerId: "1", imageUrl: "http://x/y.png", name: "Pic", userId: "u2" });
    expect((axios as any).get).toHaveBeenCalledWith("http://x/y.png", { responseType: "arraybuffer" });
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.asset_operation.create).toMatchObject({
      type: "IMAGE",
      name: "Pic",
      image_asset: { data: Buffer.from("imgbytes").toString("base64") },
    });
  });

  it("works with name undefined", async () => {
    (axios as any).get.mockResolvedValue({ data: Buffer.from("z") });
    await createImageAsset({ customerId: "1", imageUrl: "http://x/y.png" });
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.asset_operation.create.name).toBeUndefined();
  });

  it("logs and rethrows when the fetch fails", async () => {
    (axios as any).get.mockRejectedValue(new Error("boom"));
    await expect(createImageAsset({ customerId: "1", imageUrl: "http://bad" })).rejects.toThrow("boom");
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("listAssets", () => {
  it("queries without a type filter (default limit)", async () => {
    await listAssets({ customerId: "1", limit: 50 });
    const q = customer.query.mock.calls[0][0] as string;
    expect(q).not.toContain("WHERE");
    expect(q).toContain("FROM asset");
    expect(q).toContain("ORDER BY asset.id DESC LIMIT 50");
  });

  it("adds a WHERE clause when types are provided", async () => {
    await listAssets({ customerId: "1", limit: 10, types: ["TEXT", "IMAGE"] });
    const q = customer.query.mock.calls[0][0] as string;
    expect(q).toContain("WHERE asset.type IN ('TEXT','IMAGE')");
    expect(q).toContain("LIMIT 10");
  });

  it("ignores an empty types array (no WHERE)", async () => {
    await listAssets({ customerId: "1", limit: 5, types: [] });
    const q = customer.query.mock.calls[0][0] as string;
    expect(q).not.toContain("WHERE");
  });

  it("returns the query rows", async () => {
    const res = await listAssets({ customerId: "1", limit: 50 });
    expect(res).toEqual([{ asset: { id: "1" } }]);
  });
});
