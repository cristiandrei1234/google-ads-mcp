import { describe, it, expect, beforeEach, vi } from "vitest";

// Mutable config object the SUT reads GOOGLE_ADS_VALIDATE_ONLY from.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: { GOOGLE_ADS_VALIDATE_ONLY: false } }));
vi.mock("../../config/env.js", () => ({ default: mockConfig }));
vi.mock("../../observability/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { runMutation } from "./mutator.js";
import logger from "../../observability/logger.js";

function fakeCustomer(mutateImpl?: (...args: unknown[]) => unknown) {
  return {
    mutateResources: vi.fn(
      mutateImpl ?? (async () => ({ results: [{ resource_name: "rn" }] }))
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.GOOGLE_ADS_VALIDATE_ONLY = false;
});

describe("runMutation - normalizeMutation passthrough", () => {
  it("passes through an already-normalized mutation (entity + resource defined)", async () => {
    const customer = fakeCustomer();
    const normalized = { entity: "campaign", operation: "create", resource: { name: "X" } };
    await runMutation(customer, [normalized]);
    expect(customer.mutateResources).toHaveBeenCalledWith(
      [normalized],
      { partial_failure: false, validate_only: false }
    );
  });
});

describe("runMutation - normalizeMutation create/update/remove", () => {
  it("normalizes a *_operation create payload and carries exempt keys", async () => {
    const customer = fakeCustomer();
    await runMutation(customer, [
      {
        campaign_operation: {
          create: { name: "C" },
          exempt_policy_violation_keys: ["k1"],
        },
      },
    ]);
    expect(customer.mutateResources.mock.calls[0][0]).toEqual([
      {
        entity: "campaign",
        operation: "create",
        resource: { name: "C" },
        exempt_policy_violation_keys: ["k1"],
      },
    ]);
  });

  it("normalizes an update payload", async () => {
    const customer = fakeCustomer();
    await runMutation(customer, [
      { ad_group_operation: { update: { id: "1", status: "PAUSED" } } },
    ]);
    expect(customer.mutateResources.mock.calls[0][0]).toEqual([
      { entity: "ad_group", operation: "update", resource: { id: "1", status: "PAUSED" } },
    ]);
  });

  it("normalizes a remove payload", async () => {
    const customer = fakeCustomer();
    await runMutation(customer, [{ campaign_operation: { remove: "customers/1/campaigns/2" } }]);
    expect(customer.mutateResources.mock.calls[0][0]).toEqual([
      { entity: "campaign", operation: "remove", resource: "customers/1/campaigns/2" },
    ]);
  });
});

describe("runMutation - normalizeMutation errors", () => {
  it("throws when mutation is not an object", async () => {
    const customer = fakeCustomer();
    await expect(runMutation(customer, [null])).rejects.toThrow(/expected object/);
    await expect(runMutation(customer, ["str" as unknown as object])).rejects.toThrow(
      /expected object/
    );
  });

  it("throws when there is no *_operation key", async () => {
    const customer = fakeCustomer();
    await expect(runMutation(customer, [{ foo: 1, bar: 2 }])).rejects.toThrow(
      /no '\*_operation' key found. Keys: foo, bar/
    );
  });

  it("throws when the operation payload is not an object", async () => {
    const customer = fakeCustomer();
    await expect(runMutation(customer, [{ campaign_operation: null }])).rejects.toThrow(
      /at 'campaign_operation': expected object/
    );
    await expect(runMutation(customer, [{ campaign_operation: "x" }])).rejects.toThrow(
      /at 'campaign_operation': expected object/
    );
  });

  it("throws when no create/update/remove key is present", async () => {
    const customer = fakeCustomer();
    await expect(runMutation(customer, [{ campaign_operation: { other: 1 } }])).rejects.toThrow(
      /expected one of create\/update\/remove keys/
    );
  });
});

describe("runMutation - options & validate_only", () => {
  it("uses default options (dryRun/partialFailure false) when none provided", async () => {
    const customer = fakeCustomer();
    await runMutation(customer, [{ campaign_operation: { create: {} } }]);
    expect(customer.mutateResources.mock.calls[0][1]).toEqual({
      partial_failure: false,
      validate_only: false,
    });
  });

  it("sets validate_only when dryRun is true", async () => {
    const customer = fakeCustomer();
    await runMutation(customer, [{ campaign_operation: { create: {} } }], { dryRun: true });
    expect(customer.mutateResources.mock.calls[0][1].validate_only).toBe(true);
  });

  it("sets validate_only when GOOGLE_ADS_VALIDATE_ONLY is forced on", async () => {
    mockConfig.GOOGLE_ADS_VALIDATE_ONLY = true;
    const customer = fakeCustomer();
    await runMutation(customer, [{ campaign_operation: { create: {} } }], { dryRun: false });
    expect(customer.mutateResources.mock.calls[0][1].validate_only).toBe(true);
  });

  it("passes partial_failure through", async () => {
    const customer = fakeCustomer();
    await runMutation(customer, [{ campaign_operation: { create: {} } }], {
      partialFailure: true,
    });
    expect(customer.mutateResources.mock.calls[0][1].partial_failure).toBe(true);
  });
});

describe("runMutation - partial failure handling", () => {
  it("throws (with message) when partialFailure & a partial_failure_error is returned", async () => {
    const customer = fakeCustomer(async () => ({
      partial_failure_error: { message: "bad op" },
    }));
    await expect(
      runMutation(customer, [{ campaign_operation: { create: {} } }], { partialFailure: true })
    ).rejects.toThrow(/partial failures: bad op/);
    expect(logger.error).toHaveBeenCalled();
  });

  it("stringifies the partial_failure_error when it has no message", async () => {
    const customer = fakeCustomer(async () => ({
      partial_failure_error: { code: 7 },
    }));
    await expect(
      runMutation(customer, [{ campaign_operation: { create: {} } }], { partialFailure: true })
    ).rejects.toThrow(/partial failures: \{"code":7\}/);
  });

  it("does NOT throw on partial_failure_error when validateOnly is set (dryRun)", async () => {
    const customer = fakeCustomer(async () => ({
      partial_failure_error: { message: "ignored" },
    }));
    const result = await runMutation(
      customer,
      [{ campaign_operation: { create: {} } }],
      { partialFailure: true, dryRun: true }
    );
    expect(result).toEqual({ partial_failure_error: { message: "ignored" } });
  });

  it("does NOT throw when partialFailure is false even if error present", async () => {
    const customer = fakeCustomer(async () => ({
      partial_failure_error: { message: "ignored" },
    }));
    const result = await runMutation(customer, [{ campaign_operation: { create: {} } }], {
      partialFailure: false,
    });
    expect(result).toMatchObject({ partial_failure_error: { message: "ignored" } });
  });

  it("returns the result when no partial_failure_error is present", async () => {
    const customer = fakeCustomer(async () => ({ results: [{ resource_name: "rn" }] }));
    const result = await runMutation(customer, [{ campaign_operation: { create: {} } }], {
      partialFailure: true,
    });
    expect(result).toEqual({ results: [{ resource_name: "rn" }] });
  });
});

describe("runMutation - error propagation", () => {
  it("logs and rethrows when mutateResources rejects", async () => {
    const customer = fakeCustomer(async () => {
      throw new Error("api down");
    });
    await expect(
      runMutation(customer, [{ campaign_operation: { create: {} } }])
    ).rejects.toThrow("api down");
    expect(logger.error).toHaveBeenCalledWith("Mutation failed: api down");
  });
});
