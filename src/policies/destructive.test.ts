import { describe, it, expect } from "vitest";
import { isDestructiveTool, checkDestructiveConfirmation } from "./destructive.js";

describe("isDestructiveTool", () => {
  it("flags remove_/delete_/unlink_ prefixes", () => {
    expect(isDestructiveTool("remove_campaign")).toBe(true);
    expect(isDestructiveTool("delete_product")).toBe(true);
    expect(isDestructiveTool("unlink_merchant_center")).toBe(true);
  });

  it("flags explicit account-level destructive tools", () => {
    expect(isDestructiveTool("update_customer")).toBe(true);
    expect(isDestructiveTool("run_batch_job")).toBe(true);
    expect(isDestructiveTool("apply_recommendation")).toBe(true);
  });

  it("does not flag read or ordinary write tools", () => {
    for (const name of [
      "list_campaigns",
      "get_product",
      "run_gaql_query",
      "create_campaign",
      "update_campaign_settings",
      "add_keyword",
      "pause_campaign",
    ]) {
      expect(isDestructiveTool(name)).toBe(false);
    }
  });
});

describe("checkDestructiveConfirmation", () => {
  it("allows non-destructive tools regardless of confirm", () => {
    expect(checkDestructiveConfirmation("create_campaign", {})).toEqual({ allowed: true });
  });

  it("blocks destructive tools without confirm", () => {
    const result = checkDestructiveConfirmation("remove_campaign", { customerId: "1" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/destructive/i);
      expect(result.reason).toContain("confirm");
    }
  });

  it("blocks when confirm is not strictly true", () => {
    expect(checkDestructiveConfirmation("remove_campaign", { confirm: "yes" }).allowed).toBe(false);
    expect(checkDestructiveConfirmation("remove_campaign", { confirm: 1 }).allowed).toBe(false);
    expect(checkDestructiveConfirmation("remove_campaign", null).allowed).toBe(false);
  });

  it("allows destructive tools with confirm: true", () => {
    expect(
      checkDestructiveConfirmation("remove_campaign", { customerId: "1", confirm: true })
    ).toEqual({ allowed: true });
  });
});
