import { describe, it, expect } from "vitest";
import { can, isWriteTool } from "./rbac.js";
import type { AuthContext } from "../auth/identityContext.js";

function ctx(role: string | null): AuthContext {
  return { userId: "u1", orgId: "o1", memberId: "m1", role };
}

describe("isWriteTool (default-deny)", () => {
  it("treats only list_/get_ and known read extras as reads", () => {
    expect(isWriteTool("list_campaigns")).toBe(false);
    expect(isWriteTool("get_product")).toBe(false);
    expect(isWriteTool("run_gaql_query")).toBe(false);
    expect(isWriteTool("generate_keyword_ideas")).toBe(false);
    expect(isWriteTool("generate_reach_forecast")).toBe(false);
  });

  it("treats every other tool (incl. non-prefixed mutators) as a write", () => {
    for (const name of [
      "create_campaign",
      "remove_keyword",
      "set_campaign_geo_targeting",
      "attach_campaign_budget",
      "detach_campaign_budget",
      "promote_experiment",
      "end_experiment",
      "duplicate_campaign",
      "clear_campaign_portfolio_bidding_strategy",
      "add_batch_job_operations",
      "run_offline_user_data_job",
    ]) {
      expect(isWriteTool(name)).toBe(true);
    }
  });
});

describe("can", () => {
  it("allows everything in single-operator mode (no identity)", () => {
    expect(can(undefined, "remove_campaign").allowed).toBe(true);
    expect(can(undefined, "list_users").allowed).toBe(true);
  });

  it("blocks write tools for read-only roles", () => {
    expect(can(ctx("viewer"), "create_campaign").allowed).toBe(false);
  });

  it("fails closed: unknown/empty/null roles cannot write", () => {
    expect(can(ctx("billing"), "create_campaign").allowed).toBe(false);
    expect(can(ctx(""), "set_campaign_geo_targeting").allowed).toBe(false);
    expect(can(ctx(null), "remove_campaign").allowed).toBe(false);
    // but reads are still fine for any authenticated role
    expect(can(ctx("billing"), "list_campaigns").allowed).toBe(true);
  });

  it("gates non-prefixed mutators by the write role too", () => {
    expect(can(ctx("viewer"), "promote_experiment").allowed).toBe(false);
    expect(can(ctx("member"), "promote_experiment").allowed).toBe(true);
  });

  it("allows read tools for read-only roles", () => {
    expect(can(ctx("viewer"), "list_campaigns").allowed).toBe(true);
    expect(can(ctx("analyst"), "run_gaql_query").allowed).toBe(true);
  });

  it("allows writes for member/admin/owner", () => {
    expect(can(ctx("member"), "create_campaign").allowed).toBe(true);
    expect(can(ctx("admin"), "remove_campaign").allowed).toBe(true);
    expect(can(ctx("owner"), "update_campaign_settings").allowed).toBe(true);
  });

  it("restricts admin-only tools to admin/owner roles", () => {
    expect(can(ctx("member"), "get_user_status").allowed).toBe(false);
    expect(can(ctx("viewer"), "list_users").allowed).toBe(false);
    expect(can(ctx("admin"), "get_user_status").allowed).toBe(true);
    expect(can(ctx("owner"), "list_users").allowed).toBe(true);
  });
});
