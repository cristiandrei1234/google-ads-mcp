import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../observability/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { generateKeywordIdeas } from "./keywordPlanner.js";
import { getCustomer } from "../services/google-ads/client.js";
import logger from "../observability/logger.js";
import { fakeCustomer } from "../test/harness.js";

function customerWithIdeas(impl?: (req: any) => any) {
  const c: any = fakeCustomer();
  c.keywordPlanIdeas = {
    generateKeywordIdeas: vi.fn(impl ?? (async () => ({ results: ["idea"] }))),
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateKeywordIdeas", () => {
  it("builds a keyword_seed request when keywordTexts provided and returns the result", async () => {
    const c = customerWithIdeas();
    (getCustomer as any).mockResolvedValue(c);

    const result = await generateKeywordIdeas({
      customerId: "123",
      keywordTexts: ["shoes", "boots"],
      languageId: "1000",
      includeAdultKeywords: false,
    } as any);

    expect(result).toEqual({ results: ["idea"] });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
    const req = c.keywordPlanIdeas.generateKeywordIdeas.mock.calls[0][0];
    expect(req).toMatchObject({
      customer_id: "123",
      language: "languageConstants/1000",
      include_adult_keywords: false,
      keyword_plan_network: "GOOGLE_SEARCH_AND_PARTNERS",
      geo_target_constants: [],
      keyword_seed: { keywords: ["shoes", "boots"] },
    });
    expect(req.url_seed).toBeUndefined();
    expect(req.site_seed).toBeUndefined();
    expect(logger.info).toHaveBeenCalled();
  });

  it("passes geoTargetConstants and userId through", async () => {
    const c = customerWithIdeas();
    (getCustomer as any).mockResolvedValue(c);

    await generateKeywordIdeas({
      customerId: "123",
      keywordTexts: ["a"],
      languageId: "1001",
      includeAdultKeywords: true,
      geoTargetConstants: ["geoTargetConstants/2840"],
      userId: "u1",
    } as any);

    expect(getCustomer).toHaveBeenCalledWith("123", "u1");
    const req = c.keywordPlanIdeas.generateKeywordIdeas.mock.calls[0][0];
    expect(req.geo_target_constants).toEqual(["geoTargetConstants/2840"]);
    expect(req.include_adult_keywords).toBe(true);
    expect(req.language).toBe("languageConstants/1001");
  });

  it("uses url_seed when url provided and no keywordTexts", async () => {
    const c = customerWithIdeas();
    (getCustomer as any).mockResolvedValue(c);

    await generateKeywordIdeas({
      customerId: "1",
      url: "https://example.com/page",
      languageId: "1000",
      includeAdultKeywords: false,
    } as any);

    const req = c.keywordPlanIdeas.generateKeywordIdeas.mock.calls[0][0];
    expect(req.url_seed).toEqual({ url: "https://example.com/page" });
    expect(req.keyword_seed).toBeUndefined();
  });

  it("uses url_seed branch even when keywordTexts is an empty array", async () => {
    const c = customerWithIdeas();
    (getCustomer as any).mockResolvedValue(c);

    await generateKeywordIdeas({
      customerId: "1",
      keywordTexts: [],
      url: "https://example.com",
      languageId: "1000",
      includeAdultKeywords: false,
    } as any);

    const req = c.keywordPlanIdeas.generateKeywordIdeas.mock.calls[0][0];
    expect(req.url_seed).toEqual({ url: "https://example.com" });
  });

  it("uses site_seed when only site provided", async () => {
    const c = customerWithIdeas();
    (getCustomer as any).mockResolvedValue(c);

    await generateKeywordIdeas({
      customerId: "1",
      site: "example.com",
      languageId: "1000",
      includeAdultKeywords: false,
    } as any);

    const req = c.keywordPlanIdeas.generateKeywordIdeas.mock.calls[0][0];
    expect(req.site_seed).toEqual({ site: "example.com" });
    expect(req.keyword_seed).toBeUndefined();
    expect(req.url_seed).toBeUndefined();
  });

  it("throws when no seed is provided", async () => {
    const c = customerWithIdeas();
    (getCustomer as any).mockResolvedValue(c);

    await expect(
      generateKeywordIdeas({
        customerId: "1",
        languageId: "1000",
        includeAdultKeywords: false,
      } as any),
    ).rejects.toThrow("Must provide either keywordTexts, url, or site");
    expect(c.keywordPlanIdeas.generateKeywordIdeas).not.toHaveBeenCalled();
  });

  it("logs and rethrows when the API call fails", async () => {
    const err = new Error("boom");
    const c = customerWithIdeas(async () => {
      throw err;
    });
    (getCustomer as any).mockResolvedValue(c);

    await expect(
      generateKeywordIdeas({
        customerId: "1",
        keywordTexts: ["a"],
        languageId: "1000",
        includeAdultKeywords: false,
      } as any),
    ).rejects.toThrow("boom");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
