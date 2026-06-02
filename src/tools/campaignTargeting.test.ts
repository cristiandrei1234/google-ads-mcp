import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerCampaignTargetingTools } from "./campaignTargeting.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerCampaignTargetingTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

const mutations = () => (runMutation as any).mock.calls;
const lastQuery = (i: number) => (runQuery as any).mock.calls[i][0].query as string;

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([]);
});

describe("campaignTargeting tools", () => {
  it("registers all 7 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "set_campaign_ad_schedule",
        "set_campaign_bidding_strategy",
        "set_campaign_content_exclusions",
        "set_campaign_device_modifiers",
        "set_campaign_geo_targeting",
        "set_campaign_labels",
        "set_campaign_language_targeting",
      ].sort()
    );
  });

  // ---- set_campaign_geo_targeting ----
  describe("set_campaign_geo_targeting", () => {
    it("returns no-op message when nothing requested", async () => {
      const res = await call("set_campaign_geo_targeting", {
        customerId: "1",
        campaignId: "7",
        addGeoTargetConstantIds: [],
        removeCriterionIds: [],
        negative: false,
      });
      expect(toolJson(res)).toEqual({ message: "No geo targeting changes requested." });
      expect(mutations().length).toBe(0);
    });

    it("builds create + remove operations and runs mutation in chunks", async () => {
      const res = await call("set_campaign_geo_targeting", {
        customerId: "1",
        campaignId: "7",
        addGeoTargetConstantIds: ["100", "200"],
        removeCriterionIds: ["55"],
        negative: true,
      });
      const ops = mutations()[0][1];
      expect(ops).toHaveLength(3);
      expect(ops[0].campaign_criterion_operation.create).toMatchObject({
        campaign: "customers/1/campaigns/7",
        negative: true,
        location: { geo_target_constant: "geoTargetConstants/100" },
      });
      expect(ops[2].campaign_criterion_operation.remove).toBe(
        "customers/1/campaignCriteria/7~55"
      );
      expect(toolJson(res)).toMatchObject({ operations: 3 });
    });

    it("splits into multiple mutation chunks when over 100 ops", async () => {
      const addGeoTargetConstantIds = Array.from({ length: 101 }, (_, i) => String(i));
      await call("set_campaign_geo_targeting", {
        customerId: "1",
        campaignId: "7",
        addGeoTargetConstantIds,
        removeCriterionIds: [],
        negative: false,
      });
      expect(mutations().length).toBe(2);
      expect(mutations()[0][1]).toHaveLength(100);
      expect(mutations()[1][1]).toHaveLength(1);
    });
  });

  // ---- set_campaign_language_targeting ----
  describe("set_campaign_language_targeting", () => {
    it("returns no-op message when nothing requested", async () => {
      const res = await call("set_campaign_language_targeting", {
        customerId: "1",
        campaignId: "7",
        addLanguageConstantIds: [],
        removeCriterionIds: [],
        negative: false,
      });
      expect(toolJson(res)).toEqual({ message: "No language targeting changes requested." });
    });

    it("builds create + remove operations", async () => {
      await call("set_campaign_language_targeting", {
        customerId: "1",
        campaignId: "7",
        addLanguageConstantIds: ["1000"],
        removeCriterionIds: ["9"],
        negative: false,
      });
      const ops = mutations()[0][1];
      expect(ops[0].campaign_criterion_operation.create).toMatchObject({
        campaign: "customers/1/campaigns/7",
        negative: false,
        language: { language_constant: "languageConstants/1000" },
      });
      expect(ops[1].campaign_criterion_operation.remove).toBe(
        "customers/1/campaignCriteria/7~9"
      );
    });
  });

  // ---- set_campaign_device_modifiers ----
  describe("set_campaign_device_modifiers", () => {
    it("queries device criteria and builds update operations", async () => {
      (runQuery as any).mockResolvedValue([
        {
          campaign_criterion: {
            resource_name: "customers/1/campaignCriteria/7~2",
            device: { type: 2 },
          },
        },
        {
          campaign_criterion: {
            resource_name: "customers/1/campaignCriteria/7~4",
            device: { type: 4 },
          },
        },
        // ignored rows: missing resource_name / zero type
        { campaign_criterion: { device: { type: 3 } } },
        { campaign_criterion: { resource_name: "x", device: { type: 0 } } },
        {},
      ]);
      await call("set_campaign_device_modifiers", {
        customerId: "1",
        campaignId: "7",
        modifiers: [
          { deviceType: "MOBILE", bidModifier: 1.2 },
          { deviceType: "DESKTOP", bidModifier: 0.8 },
        ],
      });
      expect(lastQuery(0)).toContain("campaign_criterion.type = DEVICE");
      const ops = mutations()[0][1];
      expect(ops[0].campaign_criterion_operation.update).toEqual({
        resource_name: "customers/1/campaignCriteria/7~2",
        bid_modifier: 1.2,
      });
      expect(ops[0].campaign_criterion_operation.update_mask.paths).toEqual(["bid_modifier"]);
      expect(ops[1].campaign_criterion_operation.update.resource_name).toBe(
        "customers/1/campaignCriteria/7~4"
      );
    });

    it("throws when a device criterion is not found", async () => {
      (runQuery as any).mockResolvedValue([]);
      const res = await call("set_campaign_device_modifiers", {
        customerId: "1",
        campaignId: "7",
        modifiers: [{ deviceType: "TABLET", bidModifier: 1 }],
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Device criterion not found for TABLET/);
    });
  });

  // ---- set_campaign_ad_schedule ----
  describe("set_campaign_ad_schedule", () => {
    it("returns no-op message when nothing requested", async () => {
      const res = await call("set_campaign_ad_schedule", {
        customerId: "1",
        campaignId: "7",
        addSchedules: [],
        removeCriterionIds: [],
      });
      expect(toolJson(res)).toEqual({ message: "No ad schedule changes requested." });
    });

    it("builds create ops with and without bidModifier, plus removes", async () => {
      await call("set_campaign_ad_schedule", {
        customerId: "1",
        campaignId: "7",
        addSchedules: [
          {
            dayOfWeek: "MONDAY",
            startHour: 9,
            startMinute: "ZERO",
            endHour: 17,
            endMinute: "THIRTY",
            bidModifier: 1.5,
          },
          {
            dayOfWeek: "TUESDAY",
            startHour: 8,
            startMinute: "FIFTEEN",
            endHour: 18,
            endMinute: "FORTY_FIVE",
          },
        ],
        removeCriterionIds: ["33"],
      });
      const ops = mutations()[0][1];
      expect(ops).toHaveLength(3);
      const first = ops[0].campaign_criterion_operation.create;
      expect(first.ad_schedule).toEqual({
        day_of_week: "MONDAY",
        start_hour: 9,
        start_minute: "ZERO",
        end_hour: 17,
        end_minute: "THIRTY",
      });
      expect(first.bid_modifier).toBe(1.5);
      const second = ops[1].campaign_criterion_operation.create;
      expect(second).not.toHaveProperty("bid_modifier");
      expect(ops[2].campaign_criterion_operation.remove).toBe(
        "customers/1/campaignCriteria/7~33"
      );
    });
  });

  // ---- set_campaign_content_exclusions ----
  describe("set_campaign_content_exclusions", () => {
    it("returns no-op message when nothing requested", async () => {
      const res = await call("set_campaign_content_exclusions", {
        customerId: "1",
        campaignId: "7",
        excludedPlacementUrls: [],
        excludedTopicConstantIds: [],
        removeCriterionIds: [],
      });
      expect(toolJson(res)).toEqual({ message: "No content exclusion changes requested." });
    });

    it("builds placement, topic, and remove operations", async () => {
      await call("set_campaign_content_exclusions", {
        customerId: "1",
        campaignId: "7",
        excludedPlacementUrls: ["https://bad.example.com"],
        excludedTopicConstantIds: ["123"],
        removeCriterionIds: ["44"],
      });
      const ops = mutations()[0][1];
      expect(ops).toHaveLength(3);
      expect(ops[0].campaign_criterion_operation.create).toMatchObject({
        campaign: "customers/1/campaigns/7",
        negative: true,
        placement: { url: "https://bad.example.com" },
      });
      expect(ops[1].campaign_criterion_operation.create).toMatchObject({
        negative: true,
        topic: { topic_constant: "topicConstants/123" },
      });
      expect(ops[2].campaign_criterion_operation.remove).toBe(
        "customers/1/campaignCriteria/7~44"
      );
    });
  });

  // ---- set_campaign_bidding_strategy ----
  describe("set_campaign_bidding_strategy", () => {
    it("MANUAL_CPC", async () => {
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "MANUAL_CPC",
      });
      const op = mutations()[0][1][0].campaign_operation;
      expect(op.update.manual_cpc).toEqual({});
      expect(op.update_mask.paths).toEqual(["manual_cpc"]);
    });

    it("MAXIMIZE_CONVERSIONS with and without targetCpaMicros", async () => {
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "MAXIMIZE_CONVERSIONS",
        targetCpaMicros: 5000,
      });
      let op = mutations()[0][1][0].campaign_operation;
      expect(op.update.maximize_conversions).toEqual({ target_cpa_micros: 5000 });
      expect(op.update_mask.paths).toEqual([
        "maximize_conversions",
        "maximize_conversions.target_cpa_micros",
      ]);

      vi.clearAllMocks();
      (getCustomer as any).mockResolvedValue(fakeCustomer());
      (runMutation as any).mockResolvedValue({});
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "MAXIMIZE_CONVERSIONS",
      });
      op = mutations()[0][1][0].campaign_operation;
      expect(op.update.maximize_conversions).toEqual({});
      expect(op.update_mask.paths).toEqual(["maximize_conversions"]);
    });

    it("MAXIMIZE_CONVERSION_VALUE with and without targetRoas", async () => {
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "MAXIMIZE_CONVERSION_VALUE",
        targetRoas: 4,
      });
      let op = mutations()[0][1][0].campaign_operation;
      expect(op.update.maximize_conversion_value).toEqual({ target_roas: 4 });
      expect(op.update_mask.paths).toEqual([
        "maximize_conversion_value",
        "maximize_conversion_value.target_roas",
      ]);

      vi.clearAllMocks();
      (getCustomer as any).mockResolvedValue(fakeCustomer());
      (runMutation as any).mockResolvedValue({});
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "MAXIMIZE_CONVERSION_VALUE",
      });
      op = mutations()[0][1][0].campaign_operation;
      expect(op.update.maximize_conversion_value).toEqual({});
      expect(op.update_mask.paths).toEqual(["maximize_conversion_value"]);
    });

    it("TARGET_CPA with and without targetCpaMicros", async () => {
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "TARGET_CPA",
        targetCpaMicros: 7000,
      });
      let op = mutations()[0][1][0].campaign_operation;
      expect(op.update.target_cpa).toEqual({ target_cpa_micros: 7000 });
      expect(op.update_mask.paths).toEqual(["target_cpa", "target_cpa.target_cpa_micros"]);

      vi.clearAllMocks();
      (getCustomer as any).mockResolvedValue(fakeCustomer());
      (runMutation as any).mockResolvedValue({});
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "TARGET_CPA",
      });
      op = mutations()[0][1][0].campaign_operation;
      expect(op.update.target_cpa).toEqual({});
      expect(op.update_mask.paths).toEqual(["target_cpa"]);
    });

    it("TARGET_ROAS (else branch) with and without targetRoas", async () => {
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "TARGET_ROAS",
        targetRoas: 3.5,
      });
      let op = mutations()[0][1][0].campaign_operation;
      expect(op.update.target_roas).toEqual({ target_roas: 3.5 });
      expect(op.update_mask.paths).toEqual(["target_roas", "target_roas.target_roas"]);

      vi.clearAllMocks();
      (getCustomer as any).mockResolvedValue(fakeCustomer());
      (runMutation as any).mockResolvedValue({});
      await call("set_campaign_bidding_strategy", {
        customerId: "1",
        campaignId: "7",
        strategy: "TARGET_ROAS",
      });
      op = mutations()[0][1][0].campaign_operation;
      expect(op.update.target_roas).toEqual({});
      expect(op.update_mask.paths).toEqual(["target_roas"]);
      expect(op.update.resource_name).toBe("customers/1/campaigns/7");
    });
  });

  // ---- set_campaign_labels ----
  describe("set_campaign_labels", () => {
    it("creates missing labels, attaches new ones, and removes stale (replace=true)", async () => {
      // call sequence: 1) label lookup, 2) label lookup after create,
      // 3) existing campaign labels
      (runQuery as any)
        .mockResolvedValueOnce([
          { label: { name: "Existing", resource_name: "customers/1/labels/10" } },
          // malformed row -> false branch of the name && resource_name guard
          { label: { name: "NoResource" } },
        ])
        .mockResolvedValueOnce([
          { label: { name: "Existing", resource_name: "customers/1/labels/10" } },
          { label: { name: "New", resource_name: "customers/1/labels/20" } },
          // row missing resource_name -> filtered by Boolean
          { label: { name: "Ghost" } },
        ])
        .mockResolvedValueOnce([
          // already attached -> existingSet contains labels/10
          {
            campaign_label: {
              resource_name: "customers/1/campaignLabels/7~10",
              label: "customers/1/labels/10",
            },
          },
          // stale attached label not in desired -> removed when replace
          {
            campaign_label: {
              resource_name: "customers/1/campaignLabels/7~99",
              label: "customers/1/labels/99",
            },
          },
          // row missing label -> filtered
          { campaign_label: { resource_name: "customers/1/campaignLabels/7~x" } },
        ]);

      const res = await call("set_campaign_labels", {
        customerId: "1",
        campaignId: "7",
        labelNames: ["Existing", "New"],
        replace: true,
      });

      // first mutation creates the missing label "New"
      const createCall = mutations().find(
        (c: any[]) => c[1][0]?.label_operation?.create
      );
      expect(createCall[1]).toEqual([{ label_operation: { create: { name: "New" } } }]);

      // a later mutation contains the campaign_label create for labels/20 and
      // the remove for the stale labels/99
      const labelOpsCall = mutations().find(
        (c: any[]) => c[1][0]?.campaign_label_operation
      );
      const labelOps = labelOpsCall[1];
      const creates = labelOps.filter((o: any) => o.campaign_label_operation.create);
      const removes = labelOps.filter((o: any) => o.campaign_label_operation.remove);
      expect(creates[0].campaign_label_operation.create).toEqual({
        campaign: "customers/1/campaigns/7",
        label: "customers/1/labels/20",
      });
      expect(removes[0].campaign_label_operation.remove).toBe(
        "customers/1/campaignLabels/7~99"
      );

      const json = toolJson(res) as any;
      expect(json.desiredLabels).toBe(2);
      expect(json.operations).toBe(2);
      // label name lookup query is GAQL-escaped and uses IN(...)
      expect(lastQuery(0)).toContain("WHERE label.name IN ('Existing','New')");
    });

    it("does not remove stale labels when replace=false and skips create when none missing", async () => {
      (runQuery as any)
        .mockResolvedValueOnce([
          { label: { name: "Existing", resource_name: "customers/1/labels/10" } },
        ])
        .mockResolvedValueOnce([
          { label: { name: "Existing", resource_name: "customers/1/labels/10" } },
        ])
        .mockResolvedValueOnce([
          {
            campaign_label: {
              resource_name: "customers/1/campaignLabels/7~99",
              label: "customers/1/labels/99",
            },
          },
        ]);

      const res = await call("set_campaign_labels", {
        customerId: "1",
        campaignId: "7",
        labelNames: ["Existing"],
        replace: false,
      });

      // no label create mutation (nothing missing)
      const createCall = mutations().find(
        (c: any[]) => c[1][0]?.label_operation?.create
      );
      expect(createCall).toBeUndefined();

      // desired label labels/10 not yet attached -> one campaign_label create,
      // no removes because replace=false
      const labelOpsCall = mutations().find(
        (c: any[]) => c[1][0]?.campaign_label_operation
      );
      const labelOps = labelOpsCall[1];
      expect(labelOps).toHaveLength(1);
      expect(labelOps[0].campaign_label_operation.create.label).toBe(
        "customers/1/labels/10"
      );

      const json = toolJson(res) as any;
      expect(json.operations).toBe(1);
      expect(json.desiredLabels).toBe(1);
    });

    it("chunks label creation when more than 100 labels are missing", async () => {
      // 150 desired names, none existing -> missing has 150 entries -> chunk(missing,100)
      // yields two non-empty sub-arrays (100 + 50), exercising the body of the
      // `for (const nameChunk of chunk(missing,100))` loop with real, non-empty chunks.
      const labelNames = Array.from({ length: 150 }, (_, i) => `L${i}`);
      (runQuery as any)
        .mockResolvedValueOnce([]) // initial label lookup: none exist
        .mockResolvedValueOnce(
          // after create: all now resolve to resource names
          labelNames.map((name, i) => ({
            label: { name, resource_name: `customers/1/labels/${i}` },
          }))
        )
        .mockResolvedValueOnce([]); // existing campaign labels: none attached

      const res = await call("set_campaign_labels", {
        customerId: "1",
        campaignId: "7",
        labelNames,
        replace: true,
      });

      // label_operation create mutations are split into two non-empty chunks.
      const createCalls = mutations().filter(
        (c: any[]) => c[1][0]?.label_operation?.create
      );
      expect(createCalls.length).toBe(2);
      expect(createCalls[0][1]).toHaveLength(100);
      expect(createCalls[1][1]).toHaveLength(50);
      // every chunk passed to runMutation is non-empty (length > 0 guard always true).
      for (const c of createCalls) {
        expect(c[1].length).toBeGreaterThan(0);
      }

      // 150 desired labels, none attached -> 150 campaign_label creates, also chunked.
      const labelOpsCalls = mutations().filter(
        (c: any[]) => c[1][0]?.campaign_label_operation
      );
      const totalLabelOps = labelOpsCalls.reduce((n: number, c: any[]) => n + c[1].length, 0);
      expect(totalLabelOps).toBe(150);
      for (const c of labelOpsCalls) {
        expect(c[1].length).toBeGreaterThan(0);
      }
      expect((toolJson(res) as any).desiredLabels).toBe(150);
      expect((toolJson(res) as any).operations).toBe(150);
    });

    it("produces zero operations when all desired labels already attached", async () => {
      (runQuery as any)
        .mockResolvedValueOnce([
          { label: { name: "A", resource_name: "customers/1/labels/1" } },
        ])
        .mockResolvedValueOnce([
          { label: { name: "A", resource_name: "customers/1/labels/1" } },
        ])
        .mockResolvedValueOnce([
          {
            campaign_label: {
              resource_name: "customers/1/campaignLabels/7~1",
              label: "customers/1/labels/1",
            },
          },
        ]);

      const res = await call("set_campaign_labels", {
        customerId: "1",
        campaignId: "7",
        labelNames: ["A"],
        replace: true,
      });
      // no campaign_label mutation issued (operations empty)
      const labelOpsCall = mutations().find(
        (c: any[]) => c[1][0]?.campaign_label_operation
      );
      expect(labelOpsCall).toBeUndefined();
      expect((toolJson(res) as any).operations).toBe(0);
    });
  });
});
