import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../observability/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  createBatchJob,
  listBatchJobs,
  runBatchJob,
  addBatchJobOperations,
} from "./batchJobs.js";
import { getCustomer } from "../services/google-ads/client.js";
import logger from "../observability/logger.js";
import { fakeCustomer } from "../test/harness.js";

function makeCustomer() {
  const base = fakeCustomer([{ batch_job: { id: "5" } }]);
  const mutateBatchJob = vi.fn(async () => [{ resource_name: "customers/1/batchJobs/5" }]);
  const loadService = vi.fn(() => ({ mutateBatchJob }));
  const runBatchJobFn = vi.fn(async () => ({ done: true }));
  const addBatchJobOperationsFn = vi.fn(async () => ({ next_sequence_token: "tok" }));
  return Object.assign(base, {
    loadService,
    callHeaders: { "login-customer-id": "1" },
    batchJobs: {
      runBatchJob: runBatchJobFn,
      addBatchJobOperations: addBatchJobOperationsFn,
    },
    __mutateBatchJob: mutateBatchJob,
  });
}

let customer: ReturnType<typeof makeCustomer>;

beforeEach(() => {
  vi.clearAllMocks();
  customer = makeCustomer();
  (getCustomer as any).mockResolvedValue(customer);
});

describe("createBatchJob", () => {
  it("creates a batch job without scramblingId", async () => {
    const result = await createBatchJob({ customerId: "1" });
    expect(result).toEqual({ resource_name: "customers/1/batchJobs/5" });
    expect(customer.loadService).toHaveBeenCalledWith("BatchJobServiceClient");
    const [request, opts] = customer.__mutateBatchJob.mock.calls[0];
    expect(request.customer_id).toBe("1");
    expect(request.operation).toEqual({ create: {} });
    expect(opts.otherArgs.headers).toBe(customer.callHeaders);
  });

  it("includes scrambling_id when scramblingId is provided", async () => {
    await createBatchJob({ customerId: "1", scramblingId: "abc", userId: "u" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
    const [request] = customer.__mutateBatchJob.mock.calls[0];
    expect(request.operation.create.scrambling_id).toBe("abc");
  });

  it("logs and rethrows on failure", async () => {
    customer.__mutateBatchJob.mockRejectedValue(new Error("create failed"));
    await expect(createBatchJob({ customerId: "1" })).rejects.toThrow("create failed");
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining("create failed"));
  });
});

describe("listBatchJobs", () => {
  it("queries with the default limit", async () => {
    const rows = await listBatchJobs({ customerId: "1", limit: 50 });
    expect(rows).toEqual([{ batch_job: { id: "5" } }]);
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("FROM batch_job");
    expect(q).toContain("LIMIT 50");
    expect(getCustomer).toHaveBeenCalledWith("1", undefined);
  });

  it("honors a custom limit and userId", async () => {
    await listBatchJobs({ customerId: "1", limit: 7, userId: "u" });
    expect(customer.query.mock.calls[0][0]).toContain("LIMIT 7");
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
  });
});

describe("runBatchJob", () => {
  it("runs the batch job by resource name", async () => {
    const result = await runBatchJob({
      customerId: "1",
      batchJobResourceName: "customers/1/batchJobs/5",
    });
    expect(result).toEqual({ done: true });
    expect(customer.batchJobs.runBatchJob).toHaveBeenCalledWith({
      resource_name: "customers/1/batchJobs/5",
    });
  });

  it("logs and rethrows on failure", async () => {
    customer.batchJobs.runBatchJob.mockRejectedValue(new Error("run failed"));
    await expect(
      runBatchJob({ customerId: "1", batchJobResourceName: "rn" })
    ).rejects.toThrow("run failed");
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining("run failed"));
  });
});

describe("addBatchJobOperations", () => {
  it("skips when no operations provided", async () => {
    const result = await addBatchJobOperations({
      customerId: "1",
      batchJobResourceName: "rn",
      operations: [],
    });
    expect(result).toEqual({
      skipped: true,
      reason: "No operations provided. Pass at least one mutate operation.",
    });
    expect(customer.batchJobs.addBatchJobOperations).not.toHaveBeenCalled();
  });

  it("skips when operations is undefined", async () => {
    const result = await addBatchJobOperations({
      customerId: "1",
      batchJobResourceName: "rn",
      operations: undefined as any,
    });
    expect((result as any).skipped).toBe(true);
  });

  it("adds operations when provided", async () => {
    const ops = [{ campaign_operation: { create: { name: "C" } } }];
    const result = await addBatchJobOperations({
      customerId: "1",
      batchJobResourceName: "customers/1/batchJobs/5",
      operations: ops,
    });
    expect(result).toEqual({ next_sequence_token: "tok" });
    expect(customer.batchJobs.addBatchJobOperations).toHaveBeenCalledWith({
      resource_name: "customers/1/batchJobs/5",
      mutate_operations: ops,
    });
  });

  it("logs and rethrows on failure", async () => {
    customer.batchJobs.addBatchJobOperations.mockRejectedValue(new Error("add failed"));
    await expect(
      addBatchJobOperations({
        customerId: "1",
        batchJobResourceName: "rn",
        operations: [{ x: 1 }],
      })
    ).rejects.toThrow("add failed");
    expect((logger as any).error).toHaveBeenCalledWith(expect.stringContaining("add failed"));
  });
});
