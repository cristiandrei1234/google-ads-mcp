import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import { createResponsiveSearchAd, pauseAd, enableAd, removeAd } from "./ads.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { fakeCustomer } from "../test/harness.js";

const customer = fakeCustomer();

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(customer);
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("ads tools", () => {
  it("createResponsiveSearchAd maps headlines/descriptions with optional pins and paths", async () => {
    await createResponsiveSearchAd({
      customerId: "123",
      adGroupId: "55",
      headlines: [
        { text: "H1", pinnedField: "HEADLINE_1" },
        { text: "H2" },
        { text: "H3" },
      ],
      descriptions: [{ text: "D1", pinnedField: "DESCRIPTION_1" }, { text: "D2" }],
      finalUrls: ["https://example.com"],
      path1: "p1",
      path2: "p2",
      userId: "u1",
    });

    expect(getCustomer).toHaveBeenCalledWith("123", "u1");
    expect((runMutation as any).mock.calls[0][0]).toBe(customer);
    const create = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation.create;
    expect(create.ad_group).toBe("customers/123/adGroups/55");
    expect(create.status).toBe("ENABLED");
    const rsa = create.ad.responsive_search_ad;
    expect(rsa.headlines).toEqual([
      { text: "H1", pinned_field: "HEADLINE_1" },
      { text: "H2", pinned_field: undefined },
      { text: "H3", pinned_field: undefined },
    ]);
    expect(rsa.descriptions).toEqual([
      { text: "D1", pinned_field: "DESCRIPTION_1" },
      { text: "D2", pinned_field: undefined },
    ]);
    expect(rsa.path1).toBe("p1");
    expect(rsa.path2).toBe("p2");
    expect(create.ad.final_urls).toEqual(["https://example.com"]);
  });

  it("createResponsiveSearchAd works without optional paths/pins/userId", async () => {
    await createResponsiveSearchAd({
      customerId: "1",
      adGroupId: "2",
      headlines: [{ text: "A" }, { text: "B" }, { text: "C" }],
      descriptions: [{ text: "D" }, { text: "E" }],
      finalUrls: ["https://x.com"],
    });
    expect(getCustomer).toHaveBeenCalledWith("1", undefined);
    const rsa = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation.create.ad.responsive_search_ad;
    expect(rsa.path1).toBeUndefined();
    expect(rsa.path2).toBeUndefined();
  });

  it("pauseAd updates status to PAUSED on the composite ad resource", async () => {
    await pauseAd({ customerId: "123", adId: "9", adGroupId: "55" });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation;
    expect(op.update).toEqual({ resource_name: "customers/123/adGroupAds/55~9", status: "PAUSED" });
    expect(op.update_mask.paths).toEqual(["status"]);
  });

  it("enableAd updates status to ENABLED and forwards userId", async () => {
    await enableAd({ customerId: "123", adId: "9", adGroupId: "55", userId: "u1" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u1");
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation;
    expect(op.update.status).toBe("ENABLED");
    expect(op.update.resource_name).toBe("customers/123/adGroupAds/55~9");
    expect(op.update_mask.paths).toEqual(["status"]);
  });

  it("removeAd issues a remove operation and forwards userId", async () => {
    await removeAd({ customerId: "123", adId: "9", adGroupId: "55", userId: "u2" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u2");
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation;
    expect(op).toEqual({ remove: "customers/123/adGroupAds/55~9" });
  });

  it("removeAd works without userId", async () => {
    await removeAd({ customerId: "1", adId: "2", adGroupId: "3" });
    expect(getCustomer).toHaveBeenCalledWith("1", undefined);
  });
});
