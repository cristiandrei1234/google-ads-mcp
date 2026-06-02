import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("../observability/logger.js", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import {
  createConversionAction,
  listConversionActions,
  uploadClickConversion,
} from "./conversions.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import logger from "../observability/logger.js";
import { fakeCustomer } from "../test/harness.js";

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("conversions handlers", () => {
  it("createConversionAction builds a create operation with defaults and passes userId", async () => {
    const customer = fakeCustomer();
    (getCustomer as any).mockResolvedValue(customer);
    await createConversionAction({
      customerId: "1",
      name: "Purchase",
      type: "WEBPAGE",
      category: "PURCHASE",
      userId: "u-1",
    } as any);

    expect(getCustomer).toHaveBeenCalledWith("1", "u-1");
    const ops = (runMutation as any).mock.calls[0][1];
    expect(ops[0].conversion_action_operation.create).toEqual({
      name: "Purchase",
      type: "WEBPAGE",
      category: "PURCHASE",
      status: "ENABLED",
    });
    expect((runMutation as any).mock.calls[0][0]).toBe(customer);
  });

  it("createConversionAction works without userId (undefined branch)", async () => {
    await createConversionAction({
      customerId: "2",
      name: "Lead",
      type: "UPLOAD_CLICKS",
      category: "LEAD",
    } as any);
    expect(getCustomer).toHaveBeenCalledWith("2", undefined);
    const create = (runMutation as any).mock.calls[0][1][0].conversion_action_operation.create;
    expect(create.type).toBe("UPLOAD_CLICKS");
  });

  it("listConversionActions queries conversion_action and returns rows", async () => {
    const rows = [{ conversion_action: { id: "5" } }];
    const customer = fakeCustomer(rows);
    (getCustomer as any).mockResolvedValue(customer);

    const result = await listConversionActions({ customerId: "1", userId: "u" } as any);
    expect(result).toBe(rows);
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("FROM conversion_action");
    expect(q).toContain("conversion_action.include_in_conversions_metric");
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
  });

  it("uploadClickConversion sends a full conversion payload with value and currency", async () => {
    const customer = fakeCustomer();
    const uploadResult = { partial_failure_error: null };
    customer.conversionUploads.uploadClickConversions.mockResolvedValue(uploadResult);
    (getCustomer as any).mockResolvedValue(customer);

    const result = await uploadClickConversion({
      customerId: "123",
      conversionActionId: "456",
      gclid: "G-1",
      conversionDateTime: "2023-10-27 12:32:45-05:00",
      conversionValue: 99,
      currencyCode: "USD",
      userId: "u",
    } as any);

    expect(result).toBe(uploadResult);
    const req = customer.conversionUploads.uploadClickConversions.mock.calls[0][0];
    expect(req).toMatchObject({
      customer_id: "123",
      partial_failure: true,
      validate_only: false,
    });
    expect(req.conversions[0]).toEqual({
      gclid: "G-1",
      conversion_action: "customers/123/conversionActions/456",
      conversion_date_time: "2023-10-27 12:32:45-05:00",
      conversion_value: 99,
      currency_code: "USD",
    });
  });

  it("uploadClickConversion works without optional value/currency", async () => {
    const customer = fakeCustomer();
    (getCustomer as any).mockResolvedValue(customer);
    await uploadClickConversion({
      customerId: "123",
      conversionActionId: "456",
      gclid: "G-2",
      conversionDateTime: "2023-10-27 12:32:45-05:00",
    } as any);
    const req = customer.conversionUploads.uploadClickConversions.mock.calls[0][0];
    expect(req.conversions[0].conversion_value).toBeUndefined();
    expect(req.conversions[0].currency_code).toBeUndefined();
  });

  it("uploadClickConversion logs and rethrows on failure", async () => {
    const customer = fakeCustomer();
    const err = new Error("boom");
    customer.conversionUploads.uploadClickConversions.mockRejectedValue(err);
    (getCustomer as any).mockResolvedValue(customer);

    await expect(
      uploadClickConversion({
        customerId: "1",
        conversionActionId: "2",
        gclid: "g",
        conversionDateTime: "d",
      } as any)
    ).rejects.toThrow("boom");
    expect((logger as any).error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to upload click conversion: boom")
    );
  });
});
