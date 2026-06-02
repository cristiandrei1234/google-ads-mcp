import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerExperimentsAdvancedTools } from "./experimentsAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson } from "../test/harness.js";

const tools = captureTools(registerExperimentsAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

function makeServiceFake(service: Record<string, any>) {
  return {
    loadService: vi.fn(() => service),
    callHeaders: { "x-h": "1" },
  };
}

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ experiment_arm: { name: "arm" } }]);
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe("registerExperimentsAdvancedTools", () => {
  it("registers all 7 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "end_experiment",
        "list_experiment_arms",
        "list_experiment_async_errors",
        "promote_experiment",
        "remove_experiment",
        "schedule_experiment",
        "update_experiment",
      ].sort()
    );
  });
});

describe("update_experiment", () => {
  it("builds an update mask from all provided fields and a bare id resource name", async () => {
    (getCustomer as any).mockResolvedValue(makeServiceFake({}));
    await call("update_experiment", {
      customerId: "123-456-7890",
      experimentId: "55",
      name: "N",
      suffix: "-s",
      status: "INITIATED",
    });
    const op = (runMutation as any).mock.calls[0][1][0].experiment_operation;
    expect(op.update_mask.paths).toEqual(["name", "suffix", "status"]);
    expect(op.update).toMatchObject({
      resource_name: "customers/1234567890/experiments/55",
      name: "N",
      suffix: "-s",
      status: "INITIATED",
    });
  });

  it("accepts an already-qualified resource name unchanged and a single field", async () => {
    (getCustomer as any).mockResolvedValue(makeServiceFake({}));
    await call("update_experiment", {
      customerId: "1",
      experimentId: "customers/9/experiments/8",
      name: "Only",
    });
    const op = (runMutation as any).mock.calls[0][1][0].experiment_operation;
    expect(op.update_mask.paths).toEqual(["name"]);
    expect(op.update.resource_name).toBe("customers/9/experiments/8");
  });

  it("covers suffix-only and status-only branches", async () => {
    (getCustomer as any).mockResolvedValue(makeServiceFake({}));
    await call("update_experiment", { customerId: "1", experimentId: "5", suffix: "x" });
    expect((runMutation as any).mock.calls[0][1][0].experiment_operation.update_mask.paths).toEqual(["suffix"]);

    vi.clearAllMocks();
    (runMutation as any).mockResolvedValue({});
    (getCustomer as any).mockResolvedValue(makeServiceFake({}));
    await call("update_experiment", { customerId: "1", experimentId: "5", status: "HALTED" });
    expect((runMutation as any).mock.calls[0][1][0].experiment_operation.update_mask.paths).toEqual(["status"]);
  });

  it("errors when no fields are provided", async () => {
    (getCustomer as any).mockResolvedValue(makeServiceFake({}));
    const res = await call("update_experiment", { customerId: "1", experimentId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
  });
});

describe("schedule_experiment", () => {
  it("schedules with default validateOnly (env false) and no completion when waitForCompletion is false", async () => {
    delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
    const scheduleExperiment = vi.fn(async () => [{ promise: vi.fn() }, { name: "op/1" }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ scheduleExperiment }));
    const res = await call("schedule_experiment", { customerId: "1", experimentId: "5" });
    const out = toolJson(res) as any;
    expect(out.validateOnly).toBe(false);
    expect(out.operationName).toBe("op/1");
    expect(out.experimentResourceName).toBe("customers/1/experiments/5");
    expect(out.completion).toBeUndefined();
    const [reqArg, optsArg] = scheduleExperiment.mock.calls[0];
    expect(reqArg).toEqual({ resource_name: "customers/1/experiments/5", validate_only: false });
    expect(optsArg.otherArgs.headers).toEqual({ "x-h": "1" });
  });

  it("awaits operation.promise when waitForCompletion is true and promise exists", async () => {
    const promise = vi.fn(async () => ({ done: true }));
    const scheduleExperiment = vi.fn(async () => [{ promise }, { name: "op/2" }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ scheduleExperiment }));
    const res = await call("schedule_experiment", {
      customerId: "1",
      experimentId: "5",
      waitForCompletion: true,
      validateOnly: true,
    });
    const out = toolJson(res) as any;
    expect(out.validateOnly).toBe(true);
    expect(out.completion).toEqual({ done: true });
    expect(promise).toHaveBeenCalled();
  });

  it("does not await completion when waitForCompletion true but operation has no promise", async () => {
    const scheduleExperiment = vi.fn(async () => [null, { name: "op/3" }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ scheduleExperiment }));
    const res = await call("schedule_experiment", { customerId: "1", experimentId: "5", waitForCompletion: true });
    const out = toolJson(res) as any;
    expect(out.completion).toBeUndefined();
    expect(out.operationName).toBe("op/3");
  });

  it("derives validateOnly from env when override is not given", async () => {
    process.env.GOOGLE_ADS_VALIDATE_ONLY = "yes";
    const scheduleExperiment = vi.fn(async () => [{ promise: vi.fn() }, { name: "op/4" }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ scheduleExperiment }));
    const res = await call("schedule_experiment", { customerId: "1", experimentId: "5" });
    expect((toolJson(res) as any).validateOnly).toBe(true);
    expect(scheduleExperiment.mock.calls[0][0].validate_only).toBe(true);
  });

  it("handles missing rawOperation name gracefully", async () => {
    const scheduleExperiment = vi.fn(async () => [{ promise: vi.fn() }, undefined]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ scheduleExperiment }));
    const res = await call("schedule_experiment", { customerId: "1", experimentId: "5" });
    expect((toolJson(res) as any).operationName).toBeUndefined();
  });
});

describe("promote_experiment", () => {
  it("promotes and awaits completion when requested", async () => {
    const promise = vi.fn(async () => ({ promoted: true }));
    const promoteExperiment = vi.fn(async () => [{ promise }, { name: "op/p1" }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ promoteExperiment }));
    const res = await call("promote_experiment", {
      customerId: "1",
      experimentId: "customers/2/experiments/3",
      waitForCompletion: true,
      validateOnly: false,
    });
    const out = toolJson(res) as any;
    expect(out.experimentResourceName).toBe("customers/2/experiments/3");
    expect(out.validateOnly).toBe(false);
    expect(out.operationName).toBe("op/p1");
    expect(out.completion).toEqual({ promoted: true });
  });

  it("does not await completion by default and reads validateOnly from env", async () => {
    process.env.GOOGLE_ADS_VALIDATE_ONLY = "1";
    const promoteExperiment = vi.fn(async () => [{ promise: vi.fn() }, { name: "op/p2" }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ promoteExperiment }));
    const res = await call("promote_experiment", { customerId: "1", experimentId: "5" });
    const out = toolJson(res) as any;
    expect(out.completion).toBeUndefined();
    expect(out.validateOnly).toBe(true);
  });

  it("handles operation without promise when waitForCompletion is true", async () => {
    const promoteExperiment = vi.fn(async () => [undefined, { name: "op/p3" }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ promoteExperiment }));
    const res = await call("promote_experiment", { customerId: "1", experimentId: "5", waitForCompletion: true });
    expect((toolJson(res) as any).completion).toBeUndefined();
  });
});

describe("end_experiment", () => {
  it("ends the experiment passing the experiment resource name and validate flag", async () => {
    delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
    const endExperiment = vi.fn(async () => [{ ended: true }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ endExperiment }));
    const res = await call("end_experiment", { customerId: "1", experimentId: "5", validateOnly: true });
    const out = toolJson(res) as any;
    expect(out.experimentResourceName).toBe("customers/1/experiments/5");
    expect(out.validateOnly).toBe(true);
    expect(out.result).toEqual({ ended: true });
    const [reqArg, optsArg] = endExperiment.mock.calls[0];
    expect(reqArg).toEqual({ experiment: "customers/1/experiments/5", validate_only: true });
    expect(optsArg.otherArgs.headers).toEqual({ "x-h": "1" });
  });

  it("uses env validate flag when no override is given", async () => {
    process.env.GOOGLE_ADS_VALIDATE_ONLY = "true";
    const endExperiment = vi.fn(async () => [{ ended: true }]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ endExperiment }));
    const res = await call("end_experiment", { customerId: "1", experimentId: "5" });
    expect((toolJson(res) as any).validateOnly).toBe(true);
  });
});

describe("remove_experiment", () => {
  it("issues a remove mutation with the resolved resource name", async () => {
    (getCustomer as any).mockResolvedValue(makeServiceFake({}));
    await call("remove_experiment", { customerId: "123-456-7890", experimentId: "55" });
    const op = (runMutation as any).mock.calls[0][1][0].experiment_operation;
    expect(op.remove).toBe("customers/1234567890/experiments/55");
  });
});

describe("list_experiment_arms", () => {
  it("builds a GAQL query filtered by the experiment resource name with the limit", async () => {
    await call("list_experiment_arms", { customerId: "1", experimentId: "5", limit: 25 });
    const arg = (runQuery as any).mock.calls[0][0];
    expect(arg.customerId).toBe("1");
    expect(arg.query).toContain("FROM experiment_arm");
    expect(arg.query).toContain("WHERE experiment_arm.experiment = 'customers/1/experiments/5'");
    expect(arg.query).toContain("LIMIT 25");
  });

  it("forwards userId in the runQuery call", async () => {
    await call("list_experiment_arms", { customerId: "1", experimentId: "5", limit: 100, userId: "u" });
    const arg = (runQuery as any).mock.calls[0][0];
    expect(arg.userId).toBe("u");
    expect(arg.query).toContain("LIMIT 100");
  });
});

describe("list_experiment_async_errors", () => {
  it("returns statuses, request and nextPageToken from the response", async () => {
    const listExperimentAsyncErrors = vi.fn(async () => [
      [{ code: 1 }],
      { req: true },
      { next_page_token: "tok" },
    ]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ listExperimentAsyncErrors }));
    const res = await call("list_experiment_async_errors", {
      customerId: "1",
      experimentId: "5",
      pageSize: 10,
      pageToken: "p0",
    });
    const out = toolJson(res) as any;
    expect(out.experimentResourceName).toBe("customers/1/experiments/5");
    expect(out.statuses).toEqual([{ code: 1 }]);
    expect(out.request).toEqual({ req: true });
    expect(out.nextPageToken).toBe("tok");
    const [reqArg, optsArg] = listExperimentAsyncErrors.mock.calls[0];
    expect(reqArg).toEqual({ resource_name: "customers/1/experiments/5", page_size: 10, page_token: "p0" });
    expect(optsArg.otherArgs.headers).toEqual({ "x-h": "1" });
  });

  it("handles a response without next_page_token", async () => {
    const listExperimentAsyncErrors = vi.fn(async () => [[], {}, undefined]);
    (getCustomer as any).mockResolvedValue(makeServiceFake({ listExperimentAsyncErrors }));
    const res = await call("list_experiment_async_errors", { customerId: "1", experimentId: "5", pageSize: 100 });
    const out = toolJson(res) as any;
    expect(out.nextPageToken).toBeUndefined();
    expect(listExperimentAsyncErrors.mock.calls[0][0].page_size).toBe(100);
  });
});
