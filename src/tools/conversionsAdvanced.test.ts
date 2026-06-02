import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import { registerConversionsAdvancedTools } from "./conversionsAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerConversionsAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

let customer: ReturnType<typeof fakeCustomer>;
beforeEach(() => {
  vi.clearAllMocks();
  customer = fakeCustomer();
  (getCustomer as any).mockResolvedValue(customer);
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("conversionsAdvanced tools", () => {
  it("registers all 7 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "update_conversion_action",
        "remove_conversion_action",
        "upload_call_conversion",
        "upload_conversion_adjustment",
        "create_offline_user_data_job",
        "add_offline_user_data_job_operations",
        "run_offline_user_data_job",
      ].sort()
    );
  });

  describe("update_conversion_action", () => {
    it("builds an update mask from all provided fields including includeInConversionsMetric=false", async () => {
      await call("update_conversion_action", {
        customerId: "1",
        conversionActionId: "9",
        name: "N",
        status: "PAUSED",
        category: "PURCHASE",
        includeInConversionsMetric: false,
      });
      const op = (runMutation as any).mock.calls[0][1][0].conversion_action_operation;
      expect(op.update.resource_name).toBe("customers/1/conversionActions/9");
      expect(op.update).toMatchObject({
        name: "N",
        status: "PAUSED",
        category: "PURCHASE",
        include_in_conversions_metric: false,
      });
      expect(op.update_mask.paths).toEqual([
        "name",
        "status",
        "category",
        "include_in_conversions_metric",
      ]);
    });

    it("includes include_in_conversions_metric when true", async () => {
      await call("update_conversion_action", {
        customerId: "1",
        conversionActionId: "9",
        includeInConversionsMetric: true,
      });
      const op = (runMutation as any).mock.calls[0][1][0].conversion_action_operation;
      expect(op.update.include_in_conversions_metric).toBe(true);
      expect(op.update_mask.paths).toEqual(["include_in_conversions_metric"]);
    });

    it("errors when no updatable field is provided", async () => {
      const res = await call("update_conversion_action", { customerId: "1", conversionActionId: "9" });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
    });
  });

  it("remove_conversion_action issues a remove operation", async () => {
    await call("remove_conversion_action", { customerId: "1", conversionActionId: "9" });
    const op = (runMutation as any).mock.calls[0][1][0].conversion_action_operation;
    expect(op.remove).toBe("customers/1/conversionActions/9");
  });

  describe("upload_call_conversion", () => {
    it("uploads a call conversion with value and currency", async () => {
      await call("upload_call_conversion", {
        customerId: "7",
        conversionActionId: "3",
        callerId: "+15551112222",
        callStartDateTime: "2026-01-01 10:00:00+00:00",
        conversionDateTime: "2026-01-01 11:00:00+00:00",
        conversionValue: 5,
        currencyCode: "EUR",
      });
      const req = customer.conversionUploads.uploadCallConversions.mock.calls[0][0];
      expect(req).toMatchObject({ customer_id: "7", partial_failure: true });
      expect(req.conversions[0]).toEqual({
        caller_id: "+15551112222",
        call_start_date_time: "2026-01-01 10:00:00+00:00",
        conversion_date_time: "2026-01-01 11:00:00+00:00",
        conversion_action: "customers/7/conversionActions/3",
        conversion_value: 5,
        currency_code: "EUR",
      });
    });

    it("uploads without optional value/currency", async () => {
      await call("upload_call_conversion", {
        customerId: "7",
        conversionActionId: "3",
        callerId: "+1",
        callStartDateTime: "a",
        conversionDateTime: "b",
      });
      const req = customer.conversionUploads.uploadCallConversions.mock.calls[0][0];
      expect(req.conversions[0].conversion_value).toBeUndefined();
      expect(req.conversions[0].currency_code).toBeUndefined();
    });
  });

  describe("upload_conversion_adjustment", () => {
    it("RETRACTION omits restatement_value", async () => {
      await call("upload_conversion_adjustment", {
        customerId: "4",
        conversionActionId: "8",
        gclid: "G",
        conversionDateTime: "2026-01-01 00:00:00+00:00",
        adjustmentDateTime: "2026-01-02 00:00:00+00:00",
        adjustmentType: "RETRACTION",
      });
      const req = customer.conversionAdjustmentUploads.uploadConversionAdjustments.mock.calls[0][0];
      expect(req).toMatchObject({ customer_id: "4", partial_failure: true });
      const adj = req.conversion_adjustments[0];
      expect(adj.adjustment_type).toBe("RETRACTION");
      expect(adj.conversion_action).toBe("customers/4/conversionActions/8");
      expect(adj.gclid_date_time_pair).toEqual({
        gclid: "G",
        conversion_date_time: "2026-01-01 00:00:00+00:00",
      });
      expect(adj.restatement_value).toBeUndefined();
    });

    it("RESTATEMENT includes restatement_value", async () => {
      await call("upload_conversion_adjustment", {
        customerId: "4",
        conversionActionId: "8",
        gclid: "G",
        conversionDateTime: "d1",
        adjustmentDateTime: "d2",
        adjustmentType: "RESTATEMENT",
        adjustedValue: 42,
        currencyCode: "USD",
      });
      const adj = customer.conversionAdjustmentUploads.uploadConversionAdjustments.mock.calls[0][0]
        .conversion_adjustments[0];
      expect(adj.restatement_value).toEqual({ adjusted_value: 42, currency_code: "USD" });
    });

    it("RESTATEMENT errors when adjustedValue missing", async () => {
      const res = await call("upload_conversion_adjustment", {
        customerId: "4",
        conversionActionId: "8",
        gclid: "G",
        conversionDateTime: "d1",
        adjustmentDateTime: "d2",
        adjustmentType: "RESTATEMENT",
        currencyCode: "USD",
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/RESTATEMENT/i);
    });

    it("RESTATEMENT errors when currencyCode missing", async () => {
      const res = await call("upload_conversion_adjustment", {
        customerId: "4",
        conversionActionId: "8",
        gclid: "G",
        conversionDateTime: "d1",
        adjustmentDateTime: "d2",
        adjustmentType: "RESTATEMENT",
        adjustedValue: 1,
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/RESTATEMENT/i);
    });
  });

  describe("create_offline_user_data_job", () => {
    it("creates a customer-match job", async () => {
      await call("create_offline_user_data_job", {
        customerId: "5",
        userListId: "77",
        type: "CUSTOMER_MATCH_USER_LIST",
      });
      const req = customer.offlineUserDataJobs.createOfflineUserDataJob.mock.calls[0][0];
      expect(req.customer_id).toBe("5");
      expect(req.job.type).toBe("CUSTOMER_MATCH_USER_LIST");
      expect(req.job.customer_match_user_list_metadata.user_list).toBe("customers/5/userLists/77");
    });
  });

  describe("add_offline_user_data_job_operations", () => {
    it("forwards operations and flags when resource belongs to the customer", async () => {
      await call("add_offline_user_data_job_operations", {
        customerId: "5",
        resourceName: "customers/5/offlineUserDataJobs/9",
        operations: [{ create: { foo: 1 } }],
        enablePartialFailure: false,
        enableWarnings: false,
      });
      const req = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0];
      expect(req).toEqual({
        resource_name: "customers/5/offlineUserDataJobs/9",
        operations: [{ create: { foo: 1 } }],
        enable_partial_failure: false,
        enable_warnings: false,
      });
    });

    it("forwards partial-failure/warnings when set to true", async () => {
      await call("add_offline_user_data_job_operations", {
        customerId: "5",
        resourceName: "customers/5/offlineUserDataJobs/9",
        operations: [{ x: 1 }],
        enablePartialFailure: true,
        enableWarnings: true,
      });
      const req = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0];
      expect(req.enable_partial_failure).toBe(true);
      expect(req.enable_warnings).toBe(true);
    });

    it("errors when resourceName belongs to a different customer", async () => {
      const res = await call("add_offline_user_data_job_operations", {
        customerId: "5",
        resourceName: "customers/999/offlineUserDataJobs/9",
        operations: [{ x: 1 }],
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/does not belong/i);
      expect(customer.offlineUserDataJobs.addOfflineUserDataJobOperations).not.toHaveBeenCalled();
    });
  });

  describe("run_offline_user_data_job", () => {
    it("runs the job when the resource belongs to the customer", async () => {
      await call("run_offline_user_data_job", {
        customerId: "5",
        resourceName: "customers/5/offlineUserDataJobs/9",
      });
      const req = customer.offlineUserDataJobs.runOfflineUserDataJob.mock.calls[0][0];
      expect(req).toEqual({ resource_name: "customers/5/offlineUserDataJobs/9" });
    });

    it("errors when the resource belongs to a different customer", async () => {
      const res = await call("run_offline_user_data_job", {
        customerId: "5",
        resourceName: "customers/6/offlineUserDataJobs/9",
      });
      expect(res.isError).toBe(true);
      expect(customer.offlineUserDataJobs.runOfflineUserDataJob).not.toHaveBeenCalled();
    });
  });
});
