import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));
vi.mock("../observability/logger.js", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import {
  listExperiments,
  createExperiment,
  listReachPlanLocations,
  generateReachForecast,
} from "./experiments.js";
import { getCustomer } from "../services/google-ads/client.js";
import logger from "../observability/logger.js";

type AnyFake = {
  query: ReturnType<typeof vi.fn>;
  loadService: ReturnType<typeof vi.fn>;
  reachPlans: {
    listPlannableLocations: ReturnType<typeof vi.fn>;
    listPlannableProducts: ReturnType<typeof vi.fn>;
    generateReachForecast: ReturnType<typeof vi.fn>;
  };
  callHeaders: Record<string, string>;
};

function makeFake(overrides: Partial<AnyFake> = {}): AnyFake {
  return {
    query: vi.fn(async () => [{ experiment: { name: "E" } }]),
    loadService: vi.fn(),
    reachPlans: {
      listPlannableLocations: vi.fn(async () => ({ locations: [] })),
      listPlannableProducts: vi.fn(async () => ({})),
      generateReachForecast: vi.fn(async () => ({ forecast: 1 })),
    },
    callHeaders: { "x-h": "1" },
    ...overrides,
  };
}

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe("listExperiments", () => {
  it("builds the GAQL query with the provided limit and forwards userId", async () => {
    const fake = makeFake();
    (getCustomer as any).mockResolvedValue(fake);
    const rows = await listExperiments({ customerId: "123", limit: 7, userId: "u1" } as any);
    expect(getCustomer).toHaveBeenCalledWith("123", "u1");
    const query = fake.query.mock.calls[0][0] as string;
    expect(query).toContain("FROM experiment");
    expect(query).toContain("LIMIT 7");
    expect(query).toContain("experiment.experiment_id");
    expect(rows).toEqual([{ experiment: { name: "E" } }]);
  });

  it("works without userId", async () => {
    const fake = makeFake();
    (getCustomer as any).mockResolvedValue(fake);
    await listExperiments({ customerId: "123", limit: 50 } as any);
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
  });
});

describe("createExperiment", () => {
  it("maps each enum type to its numeric value and starts in SETUP status", async () => {
    const cases: Array<[string, number]> = [
      ["DISPLAY_AND_VIDEO_360", 2],
      ["AD_VARIATION", 3],
      ["YOUTUBE_CUSTOM", 5],
      ["DISPLAY_CUSTOM", 6],
      ["SEARCH_CUSTOM", 7],
      ["DISPLAY_AUTOMATED_BIDDING_STRATEGY", 8],
      ["SEARCH_AUTOMATED_BIDDING_STRATEGY", 9],
      ["SHOPPING_AUTOMATED_BIDDING_STRATEGY", 10],
      ["SMART_MATCHING", 11],
      ["HOTEL_CUSTOM", 12],
    ];
    for (const [type, expected] of cases) {
      vi.clearAllMocks();
      const mutateExperiments = vi.fn(async () => [{ ok: true }]);
      const service = { mutateExperiments };
      const fake = makeFake({ loadService: vi.fn(() => service) });
      (getCustomer as any).mockResolvedValue(fake);

      const result = await createExperiment({
        customerId: "123-456-7890",
        name: "Exp",
        suffix: "-test",
        type: type as any,
      } as any);

      expect(fake.loadService).toHaveBeenCalledWith("ExperimentServiceClient");
      const [reqArg, optsArg] = mutateExperiments.mock.calls[0];
      expect(reqArg.customer_id).toBe("1234567890");
      const create = reqArg.operations[0].create;
      expect(create).toMatchObject({ name: "Exp", suffix: "-test", type: expected, status: 6 });
      expect(reqArg.validate_only).toBe(false);
      expect(optsArg.otherArgs.headers).toEqual(fake.callHeaders);
      expect(result).toEqual({ ok: true });
    }
  });

  it("sets validate_only true when GOOGLE_ADS_VALIDATE_ONLY is truthy", async () => {
    for (const v of ["1", "true", "yes", "TRUE", "Yes"]) {
      vi.clearAllMocks();
      process.env.GOOGLE_ADS_VALIDATE_ONLY = v;
      const mutateExperiments = vi.fn(async () => [{ ok: true }]);
      const fake = makeFake({ loadService: vi.fn(() => ({ mutateExperiments })) });
      (getCustomer as any).mockResolvedValue(fake);
      await createExperiment({ customerId: "1", name: "n", suffix: "s", type: "SEARCH_CUSTOM" } as any);
      expect(mutateExperiments.mock.calls[0][0].validate_only).toBe(true);
    }
  });

  it("sets validate_only false when GOOGLE_ADS_VALIDATE_ONLY is unset or falsy", async () => {
    delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
    const mutateExperiments = vi.fn(async () => [{ ok: true }]);
    const fake = makeFake({ loadService: vi.fn(() => ({ mutateExperiments })) });
    (getCustomer as any).mockResolvedValue(fake);
    await createExperiment({ customerId: "1", name: "n", suffix: "s", type: "SEARCH_CUSTOM" } as any);
    expect(mutateExperiments.mock.calls[0][0].validate_only).toBe(false);

    vi.clearAllMocks();
    process.env.GOOGLE_ADS_VALIDATE_ONLY = "no";
    const mutate2 = vi.fn(async () => [{ ok: true }]);
    const fake2 = makeFake({ loadService: vi.fn(() => ({ mutateExperiments: mutate2 })) });
    (getCustomer as any).mockResolvedValue(fake2);
    await createExperiment({ customerId: "1", name: "n", suffix: "s", type: "SEARCH_CUSTOM" } as any);
    expect(mutate2.mock.calls[0][0].validate_only).toBe(false);
  });

  it("logs and rethrows on failure", async () => {
    const err = new Error("boom");
    const fake = makeFake({
      loadService: vi.fn(() => ({ mutateExperiments: vi.fn(async () => { throw err; }) })),
    });
    (getCustomer as any).mockResolvedValue(fake);
    await expect(
      createExperiment({ customerId: "1", name: "n", suffix: "s", type: "SEARCH_CUSTOM" } as any)
    ).rejects.toThrow("boom");
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining("Failed to create experiment"));
  });
});

describe("listReachPlanLocations", () => {
  it("returns the listPlannableLocations result", async () => {
    const fake = makeFake();
    (getCustomer as any).mockResolvedValue(fake);
    const result = await listReachPlanLocations({ customerId: "1", userId: "u" } as any);
    expect(fake.reachPlans.listPlannableLocations).toHaveBeenCalledWith({});
    expect(result).toEqual({ locations: [] });
  });

  it("logs and rethrows on failure", async () => {
    const err = new Error("nope");
    const fake = makeFake();
    fake.reachPlans.listPlannableLocations = vi.fn(async () => { throw err; });
    (getCustomer as any).mockResolvedValue(fake);
    await expect(listReachPlanLocations({ customerId: "1" } as any)).rejects.toThrow("nope");
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining("Failed to list reach plan locations"));
  });
});

describe("generateReachForecast", () => {
  it("uses plannable_product_code from product_metadata (snake_case)", async () => {
    const fake = makeFake();
    fake.reachPlans.listPlannableProducts = vi.fn(async () => ({
      product_metadata: [{ plannable_product_code: "CODE_SNAKE" }],
    }));
    (getCustomer as any).mockResolvedValue(fake);
    const result = await generateReachForecast({
      customerId: "1",
      locationId: "2840",
      currencyCode: "EUR",
      budgetMicros: "5000000",
    } as any);
    expect(fake.reachPlans.listPlannableProducts).toHaveBeenCalledWith({ plannable_location_id: "2840" });
    const req = fake.reachPlans.generateReachForecast.mock.calls[0][0];
    expect(req).toMatchObject({
      customer_id: "1",
      currency_code: "EUR",
      targeting: { plannable_location_id: "2840" },
      planned_products: [{ plannable_product_code: "CODE_SNAKE", budget_micros: 5000000 }],
    });
    expect(result).toEqual({ forecast: 1 });
  });

  it("falls back to productMetadata (camelCase) when snake_case is absent", async () => {
    const fake = makeFake();
    fake.reachPlans.listPlannableProducts = vi.fn(async () => ({
      productMetadata: [{ plannableProductCode: "CODE_CAMEL" }],
    }));
    (getCustomer as any).mockResolvedValue(fake);
    await generateReachForecast({ customerId: "1", locationId: "2840", currencyCode: "USD", budgetMicros: "10" } as any);
    expect(fake.reachPlans.generateReachForecast.mock.calls[0][0].planned_products[0].plannable_product_code).toBe("CODE_CAMEL");
  });

  it("falls back to default product code when nothing is returned", async () => {
    const fake = makeFake();
    fake.reachPlans.listPlannableProducts = vi.fn(async () => ({}));
    (getCustomer as any).mockResolvedValue(fake);
    await generateReachForecast({ customerId: "1", locationId: "2840", currencyCode: "USD", budgetMicros: "10" } as any);
    expect(fake.reachPlans.generateReachForecast.mock.calls[0][0].planned_products[0].plannable_product_code).toBe("YOUTUBE_IN_STREAM_LINEUP");
  });

  it("falls back to default when product_metadata is an empty array", async () => {
    const fake = makeFake();
    fake.reachPlans.listPlannableProducts = vi.fn(async () => ({ product_metadata: [] }));
    (getCustomer as any).mockResolvedValue(fake);
    await generateReachForecast({ customerId: "1", locationId: "2840", currencyCode: "USD", budgetMicros: "10" } as any);
    expect(fake.reachPlans.generateReachForecast.mock.calls[0][0].planned_products[0].plannable_product_code).toBe("YOUTUBE_IN_STREAM_LINEUP");
  });

  it("logs and rethrows on failure", async () => {
    const err = new Error("forecast-fail");
    const fake = makeFake();
    fake.reachPlans.listPlannableProducts = vi.fn(async () => { throw err; });
    (getCustomer as any).mockResolvedValue(fake);
    await expect(
      generateReachForecast({ customerId: "1", locationId: "2840", currencyCode: "USD", budgetMicros: "10" } as any)
    ).rejects.toThrow("forecast-fail");
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining("Failed to generate reach forecast"));
  });
});
