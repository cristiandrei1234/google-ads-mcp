import { describe, it, expect, vi } from "vitest";
import {
  EnableToolsetSchema,
  enableToolsetDescription,
  enableToolsets,
  type ToolsetMember,
} from "./toolsetControl.js";
import { TOOLSETS, TOOLSET_DESCRIPTIONS, type Toolset } from "../policies/toolsets.js";

/** A registry entry that records enable() calls and flips its own state. */
function member(toolset: Toolset, enabled: boolean) {
  const entry = {
    toolset,
    enabled,
    enable: vi.fn(() => {
      entry.enabled = true;
    }),
  };
  return entry;
}

function registryOf(entries: Record<string, ReturnType<typeof member>>) {
  return new Map<string, ToolsetMember>(Object.entries(entries));
}

describe("enableToolsetDescription", () => {
  it("names every toolset and what is in it", () => {
    const description = enableToolsetDescription();
    for (const name of TOOLSETS) {
      expect(description).toContain(`- ${name}: `);
      expect(description).toContain(TOOLSET_DESCRIPTIONS[name]);
    }
  });
});

describe("TOOLSET_DESCRIPTIONS", () => {
  it("covers every toolset, with no empty entry", () => {
    expect(Object.keys(TOOLSET_DESCRIPTIONS).sort()).toEqual([...TOOLSETS].sort());
    for (const name of TOOLSETS) {
      expect(TOOLSET_DESCRIPTIONS[name].length).toBeGreaterThan(20);
    }
  });
});

describe("enableToolsets", () => {
  it("enables every tool in the requested group and leaves the rest alone", () => {
    const shopping = member("shopping", false);
    const bidding = member("bidding", false);
    const result = enableToolsets(
      registryOf({ list_products: shopping, list_bidding_strategies: bidding }),
      ["shopping"]
    );
    expect(shopping.enable).toHaveBeenCalledOnce();
    expect(bidding.enable).not.toHaveBeenCalled();
    expect(result.enabled).toEqual(["shopping"]);
    expect(result.tools).toEqual(["list_products"]);
  });

  it("accepts several groups at once, and reports the tools sorted", () => {
    const result = enableToolsets(
      registryOf({
        list_products: member("shopping", false),
        get_product: member("shopping", false),
        list_bidding_strategies: member("bidding", false),
      }),
      ["bidding", "shopping"]
    );
    expect(result.enabled.sort()).toEqual(["bidding", "shopping"]);
    expect(result.tools).toEqual(["get_product", "list_bidding_strategies", "list_products"]);
  });

  it("is case- and whitespace-insensitive", () => {
    const shopping = member("shopping", false);
    const result = enableToolsets(registryOf({ list_products: shopping }), ["  SHOPPING "]);
    expect(result.enabled).toEqual(["shopping"]);
  });

  it("reports a group that was already on instead of failing", () => {
    const shopping = member("shopping", true);
    const result = enableToolsets(registryOf({ list_products: shopping }), ["shopping"]);
    expect(shopping.enable).not.toHaveBeenCalled();
    expect(result.enabled).toEqual([]);
    expect(result.alreadyActive).toEqual(["shopping"]);
    expect(result.tools).toEqual([]);
  });

  it("counts a partially-enabled group as newly enabled, not already active", () => {
    const result = enableToolsets(
      registryOf({
        list_products: member("shopping", true),
        get_product: member("shopping", false),
      }),
      ["shopping"]
    );
    expect(result.enabled).toEqual(["shopping"]);
    expect(result.alreadyActive).toEqual([]);
    expect(result.tools).toEqual(["get_product"]);
  });

  it("echoes unknown names back alongside the valid ones", () => {
    const result = enableToolsets(
      registryOf({ list_products: member("shopping", false) }),
      ["shopping", "campaigns"]
    );
    expect(result.enabled).toEqual(["shopping"]);
    expect(result.unknown).toEqual(["campaigns"]);
  });

  it("throws with the valid list when nothing requested is a toolset", () => {
    const registry = registryOf({ list_products: member("shopping", false) });
    expect(() => enableToolsets(registry, ["campaigns"])).toThrow(/No known toolset/);
    expect(() => enableToolsets(registry, ["campaigns"])).toThrow(/Valid groups/);
    expect(() => enableToolsets(registry, [])).toThrow(/\(nothing\)/);
  });
});

describe("EnableToolsetSchema", () => {
  it("requires at least one name", () => {
    expect(EnableToolsetSchema.parse({ toolsets: ["shopping"] })).toEqual({
      toolsets: ["shopping"],
    });
    expect(() => EnableToolsetSchema.parse({ toolsets: [] })).toThrow();
    expect(() => EnableToolsetSchema.parse({})).toThrow();
  });
});
