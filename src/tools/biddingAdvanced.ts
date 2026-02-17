import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";

const BaseSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

const DeviceEnumSchema = z.enum([
  "MOBILE",
  "TABLET",
  "DESKTOP",
  "CONNECTED_TV",
  "OTHER",
]);

function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/-/g, "");
}

function extractResourceId(value: string, collection: string): string {
  const match = value.trim().match(new RegExp(`/${collection}/([^/]+)$`));
  return match?.[1] || value.trim();
}

function normalizeNumericId(value: string, collection: string): string {
  const normalized = extractResourceId(value, collection).replace(/[^0-9]/g, "");
  if (!normalized) {
    throw new Error(`Invalid ${collection} identifier: ${value}`);
  }
  return normalized;
}

function toCampaignResourceName(customerId: string, campaignIdOrResourceName: string): string {
  if (campaignIdOrResourceName.startsWith("customers/")) {
    return campaignIdOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const campaignId = normalizeNumericId(campaignIdOrResourceName, "campaigns");
  return `customers/${normalizedCustomerId}/campaigns/${campaignId}`;
}

function toBiddingStrategyResourceName(customerId: string, biddingStrategyIdOrResourceName: string): string {
  if (biddingStrategyIdOrResourceName.startsWith("customers/")) {
    return biddingStrategyIdOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const biddingStrategyId = normalizeNumericId(biddingStrategyIdOrResourceName, "biddingStrategies");
  return `customers/${normalizedCustomerId}/biddingStrategies/${biddingStrategyId}`;
}

function toSeasonalityAdjustmentResourceName(customerId: string, idOrResourceName: string): string {
  if (idOrResourceName.startsWith("customers/")) {
    return idOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const id = normalizeNumericId(idOrResourceName, "biddingSeasonalityAdjustments");
  return `customers/${normalizedCustomerId}/biddingSeasonalityAdjustments/${id}`;
}

function toDataExclusionResourceName(customerId: string, idOrResourceName: string): string {
  if (idOrResourceName.startsWith("customers/")) {
    return idOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const id = normalizeNumericId(idOrResourceName, "biddingDataExclusions");
  return `customers/${normalizedCustomerId}/biddingDataExclusions/${id}`;
}

function mapCampaignIdsToResourceNames(customerId: string, campaignIds?: string[]): string[] | undefined {
  if (!campaignIds || campaignIds.length === 0) {
    return undefined;
  }
  return campaignIds.map(campaignId => toCampaignResourceName(customerId, campaignId));
}

const ListBiddingStrategiesSchema = BaseSchema.extend({
  limit: z.number().int().min(1).max(1000).default(100),
});

async function listBiddingStrategies(args: z.infer<typeof ListBiddingStrategiesSchema>) {
  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      bidding_strategy.resource_name,
      bidding_strategy.id,
      bidding_strategy.name,
      bidding_strategy.status,
      bidding_strategy.type,
      bidding_strategy.currency_code,
      bidding_strategy.campaign_count,
      bidding_strategy.non_removed_campaign_count,
      bidding_strategy.target_cpa.target_cpa_micros,
      bidding_strategy.target_roas.target_roas,
      bidding_strategy.maximize_conversions.target_cpa_micros,
      bidding_strategy.maximize_conversion_value.target_roas,
      bidding_strategy.target_spend.target_spend_micros,
      bidding_strategy.target_spend.cpc_bid_ceiling_micros,
      bidding_strategy.target_impression_share.cpc_bid_ceiling_micros,
      bidding_strategy.target_impression_share.location,
      bidding_strategy.target_impression_share.location_fraction_micros
    FROM bidding_strategy
    ORDER BY bidding_strategy.id DESC
    LIMIT ${args.limit}`,
  });
}

const BiddingStrategyTypeSchema = z.enum([
  "TARGET_CPA",
  "TARGET_ROAS",
  "MAXIMIZE_CONVERSIONS",
  "MAXIMIZE_CONVERSION_VALUE",
  "TARGET_SPEND",
  "TARGET_IMPRESSION_SHARE",
]);

const CreatePortfolioBiddingStrategySchema = BaseSchema.extend({
  name: z.string().min(1),
  strategy: BiddingStrategyTypeSchema,
  status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).default("ENABLED"),
  targetCpaMicros: z.number().int().positive().optional(),
  targetRoas: z.number().positive().optional(),
  targetSpendMicros: z.number().int().positive().optional(),
  cpcBidCeilingMicros: z.number().int().positive().optional(),
  cpcBidFloorMicros: z.number().int().positive().optional(),
  locationFractionMicros: z.number().int().min(1).max(1000000).optional(),
  targetImpressionShareLocation: z
    .enum(["ABSOLUTE_TOP_OF_PAGE", "TOP_OF_PAGE", "ANYWHERE_ON_PAGE"])
    .optional(),
});

async function createPortfolioBiddingStrategy(args: z.infer<typeof CreatePortfolioBiddingStrategySchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const create: Record<string, unknown> = {
    name: args.name,
    status: args.status,
  };

  if (args.strategy === "TARGET_CPA") {
    create.target_cpa = args.targetCpaMicros ? { target_cpa_micros: args.targetCpaMicros } : {};
  }

  if (args.strategy === "TARGET_ROAS") {
    create.target_roas = args.targetRoas ? { target_roas: args.targetRoas } : {};
  }

  if (args.strategy === "MAXIMIZE_CONVERSIONS") {
    create.maximize_conversions = args.targetCpaMicros
      ? { target_cpa_micros: args.targetCpaMicros }
      : {};
  }

  if (args.strategy === "MAXIMIZE_CONVERSION_VALUE") {
    create.maximize_conversion_value = args.targetRoas ? { target_roas: args.targetRoas } : {};
  }

  if (args.strategy === "TARGET_SPEND") {
    const targetSpend: Record<string, unknown> = {};
    if (args.targetSpendMicros != null) {
      targetSpend.target_spend_micros = args.targetSpendMicros;
    }
    if (args.cpcBidCeilingMicros != null) {
      targetSpend.cpc_bid_ceiling_micros = args.cpcBidCeilingMicros;
    }
    if (args.cpcBidFloorMicros != null) {
      targetSpend.cpc_bid_floor_micros = args.cpcBidFloorMicros;
    }
    create.target_spend = targetSpend;
  }

  if (args.strategy === "TARGET_IMPRESSION_SHARE") {
    const targetImpressionShare: Record<string, unknown> = {};
    if (args.cpcBidCeilingMicros != null) {
      targetImpressionShare.cpc_bid_ceiling_micros = args.cpcBidCeilingMicros;
    }
    if (args.locationFractionMicros != null) {
      targetImpressionShare.location_fraction_micros = args.locationFractionMicros;
    }
    if (args.targetImpressionShareLocation) {
      targetImpressionShare.location = args.targetImpressionShareLocation;
    }
    create.target_impression_share = targetImpressionShare;
  }

  return runMutation(customer, [
    {
      bidding_strategy_operation: {
        create,
      },
    },
  ]);
}

const UpdatePortfolioBiddingStrategySchema = BaseSchema.extend({
  biddingStrategyId: z.string().describe("Bidding strategy ID/resource name"),
  name: z.string().min(1).optional(),
  status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
  strategy: BiddingStrategyTypeSchema.optional(),
  targetCpaMicros: z.number().int().positive().optional(),
  targetRoas: z.number().positive().optional(),
  targetSpendMicros: z.number().int().positive().optional(),
  cpcBidCeilingMicros: z.number().int().positive().optional(),
  cpcBidFloorMicros: z.number().int().positive().optional(),
  locationFractionMicros: z.number().int().min(1).max(1000000).optional(),
  targetImpressionShareLocation: z
    .enum(["ABSOLUTE_TOP_OF_PAGE", "TOP_OF_PAGE", "ANYWHERE_ON_PAGE"])
    .optional(),
});

async function updatePortfolioBiddingStrategy(args: z.infer<typeof UpdatePortfolioBiddingStrategySchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const update: Record<string, unknown> = {
    resource_name: toBiddingStrategyResourceName(args.customerId, args.biddingStrategyId),
  };
  const paths: string[] = [];

  if (args.name) {
    update.name = args.name;
    paths.push("name");
  }

  if (args.status) {
    update.status = args.status;
    paths.push("status");
  }

  if (args.strategy === "TARGET_CPA") {
    update.target_cpa = args.targetCpaMicros ? { target_cpa_micros: args.targetCpaMicros } : {};
    paths.push("target_cpa");
    if (args.targetCpaMicros != null) {
      paths.push("target_cpa.target_cpa_micros");
    }
  }

  if (args.strategy === "TARGET_ROAS") {
    update.target_roas = args.targetRoas ? { target_roas: args.targetRoas } : {};
    paths.push("target_roas");
    if (args.targetRoas != null) {
      paths.push("target_roas.target_roas");
    }
  }

  if (args.strategy === "MAXIMIZE_CONVERSIONS") {
    update.maximize_conversions = args.targetCpaMicros
      ? { target_cpa_micros: args.targetCpaMicros }
      : {};
    paths.push("maximize_conversions");
    if (args.targetCpaMicros != null) {
      paths.push("maximize_conversions.target_cpa_micros");
    }
  }

  if (args.strategy === "MAXIMIZE_CONVERSION_VALUE") {
    update.maximize_conversion_value = args.targetRoas ? { target_roas: args.targetRoas } : {};
    paths.push("maximize_conversion_value");
    if (args.targetRoas != null) {
      paths.push("maximize_conversion_value.target_roas");
    }
  }

  if (args.strategy === "TARGET_SPEND") {
    const targetSpend: Record<string, unknown> = {};
    if (args.targetSpendMicros != null) {
      targetSpend.target_spend_micros = args.targetSpendMicros;
      paths.push("target_spend.target_spend_micros");
    }
    if (args.cpcBidCeilingMicros != null) {
      targetSpend.cpc_bid_ceiling_micros = args.cpcBidCeilingMicros;
      paths.push("target_spend.cpc_bid_ceiling_micros");
    }
    if (args.cpcBidFloorMicros != null) {
      targetSpend.cpc_bid_floor_micros = args.cpcBidFloorMicros;
      paths.push("target_spend.cpc_bid_floor_micros");
    }
    update.target_spend = targetSpend;
    paths.push("target_spend");
  }

  if (args.strategy === "TARGET_IMPRESSION_SHARE") {
    const targetImpressionShare: Record<string, unknown> = {};
    if (args.cpcBidCeilingMicros != null) {
      targetImpressionShare.cpc_bid_ceiling_micros = args.cpcBidCeilingMicros;
      paths.push("target_impression_share.cpc_bid_ceiling_micros");
    }
    if (args.locationFractionMicros != null) {
      targetImpressionShare.location_fraction_micros = args.locationFractionMicros;
      paths.push("target_impression_share.location_fraction_micros");
    }
    if (args.targetImpressionShareLocation) {
      targetImpressionShare.location = args.targetImpressionShareLocation;
      paths.push("target_impression_share.location");
    }
    update.target_impression_share = targetImpressionShare;
    paths.push("target_impression_share");
  }

  if (paths.length === 0) {
    throw new Error("At least one field is required for update_portfolio_bidding_strategy.");
  }

  return runMutation(customer, [
    {
      bidding_strategy_operation: {
        update,
        update_mask: { paths: [...new Set(paths)] },
      },
    },
  ]);
}

const RemovePortfolioBiddingStrategySchema = BaseSchema.extend({
  biddingStrategyId: z.string().describe("Bidding strategy ID/resource name"),
});

async function removePortfolioBiddingStrategy(args: z.infer<typeof RemovePortfolioBiddingStrategySchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      bidding_strategy_operation: {
        remove: toBiddingStrategyResourceName(args.customerId, args.biddingStrategyId),
      },
    },
  ]);
}

const SetCampaignPortfolioBiddingStrategySchema = BaseSchema.extend({
  campaignId: z.string().describe("Campaign ID/resource name"),
  biddingStrategyId: z.string().describe("Portfolio bidding strategy ID/resource name"),
});

async function setCampaignPortfolioBiddingStrategy(args: z.infer<typeof SetCampaignPortfolioBiddingStrategySchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      campaign_operation: {
        update: {
          resource_name: toCampaignResourceName(args.customerId, args.campaignId),
          bidding_strategy: toBiddingStrategyResourceName(args.customerId, args.biddingStrategyId),
        },
        update_mask: {
          paths: ["bidding_strategy"],
        },
      },
    },
  ]);
}

const ClearCampaignPortfolioBiddingStrategySchema = BaseSchema.extend({
  campaignId: z.string().describe("Campaign ID/resource name"),
});

async function clearCampaignPortfolioBiddingStrategy(args: z.infer<typeof ClearCampaignPortfolioBiddingStrategySchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      campaign_operation: {
        update: {
          resource_name: toCampaignResourceName(args.customerId, args.campaignId),
          manual_cpc: {},
        },
        update_mask: {
          paths: ["manual_cpc"],
        },
      },
    },
  ]);
}

const ListBiddingSeasonalityAdjustmentsSchema = BaseSchema.extend({
  limit: z.number().int().min(1).max(1000).default(100),
});

async function listBiddingSeasonalityAdjustments(args: z.infer<typeof ListBiddingSeasonalityAdjustmentsSchema>) {
  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      bidding_seasonality_adjustment.resource_name,
      bidding_seasonality_adjustment.seasonality_adjustment_id,
      bidding_seasonality_adjustment.name,
      bidding_seasonality_adjustment.status,
      bidding_seasonality_adjustment.scope,
      bidding_seasonality_adjustment.start_date_time,
      bidding_seasonality_adjustment.end_date_time,
      bidding_seasonality_adjustment.description,
      bidding_seasonality_adjustment.conversion_rate_modifier,
      bidding_seasonality_adjustment.devices,
      bidding_seasonality_adjustment.campaigns,
      bidding_seasonality_adjustment.advertising_channel_types
    FROM bidding_seasonality_adjustment
    ORDER BY bidding_seasonality_adjustment.seasonality_adjustment_id DESC
    LIMIT ${args.limit}`,
  });
}

const SeasonalityBaseSchema = BaseSchema.extend({
  name: z.string().min(1).optional(),
  scope: z.enum(["CAMPAIGN", "CHANNEL", "CUSTOMER"]).optional(),
  status: z.enum(["ENABLED", "REMOVED"]).optional(),
  startDateTime: z.string().optional().describe("YYYY-MM-DD HH:mm:ss+00:00"),
  endDateTime: z.string().optional().describe("YYYY-MM-DD HH:mm:ss+00:00"),
  description: z.string().optional(),
  devices: z.array(DeviceEnumSchema).optional(),
  campaignIds: z.array(z.string()).optional(),
  advertisingChannelTypes: z.array(z.string()).optional(),
});

const CreateBiddingSeasonalityAdjustmentSchema = SeasonalityBaseSchema.extend({
  name: z.string().min(1),
  scope: z.enum(["CAMPAIGN", "CHANNEL", "CUSTOMER"]).default("CUSTOMER"),
  startDateTime: z.string().describe("YYYY-MM-DD HH:mm:ss+00:00"),
  endDateTime: z.string().describe("YYYY-MM-DD HH:mm:ss+00:00"),
  conversionRateModifier: z.number().positive(),
});

async function createBiddingSeasonalityAdjustment(
  args: z.infer<typeof CreateBiddingSeasonalityAdjustmentSchema>
) {
  const customer = await getCustomer(args.customerId, args.userId);

  const create: Record<string, unknown> = {
    name: args.name,
    scope: args.scope,
    start_date_time: args.startDateTime,
    end_date_time: args.endDateTime,
    conversion_rate_modifier: args.conversionRateModifier,
  };

  if (args.status) {
    create.status = args.status;
  }
  if (args.description) {
    create.description = args.description;
  }
  if (args.devices && args.devices.length > 0) {
    create.devices = args.devices;
  }
  const campaignResourceNames = mapCampaignIdsToResourceNames(args.customerId, args.campaignIds);
  if (campaignResourceNames && campaignResourceNames.length > 0) {
    create.campaigns = campaignResourceNames;
  }
  if (args.advertisingChannelTypes && args.advertisingChannelTypes.length > 0) {
    create.advertising_channel_types = args.advertisingChannelTypes;
  }

  return runMutation(customer, [
    {
      bidding_seasonality_adjustment_operation: {
        create,
      },
    },
  ]);
}

const UpdateBiddingSeasonalityAdjustmentSchema = SeasonalityBaseSchema.extend({
  seasonalityAdjustmentId: z.string().describe("Seasonality adjustment ID/resource name"),
  conversionRateModifier: z.number().positive().optional(),
});

async function updateBiddingSeasonalityAdjustment(
  args: z.infer<typeof UpdateBiddingSeasonalityAdjustmentSchema>
) {
  const customer = await getCustomer(args.customerId, args.userId);

  const update: Record<string, unknown> = {
    resource_name: toSeasonalityAdjustmentResourceName(args.customerId, args.seasonalityAdjustmentId),
  };
  const paths: string[] = [];

  if (args.name) {
    update.name = args.name;
    paths.push("name");
  }
  if (args.scope) {
    update.scope = args.scope;
    paths.push("scope");
  }
  if (args.status) {
    update.status = args.status;
    paths.push("status");
  }
  if (args.startDateTime) {
    update.start_date_time = args.startDateTime;
    paths.push("start_date_time");
  }
  if (args.endDateTime) {
    update.end_date_time = args.endDateTime;
    paths.push("end_date_time");
  }
  if (args.description !== undefined) {
    update.description = args.description;
    paths.push("description");
  }
  if (args.devices) {
    update.devices = args.devices;
    paths.push("devices");
  }
  if (args.campaignIds) {
    update.campaigns = mapCampaignIdsToResourceNames(args.customerId, args.campaignIds);
    paths.push("campaigns");
  }
  if (args.advertisingChannelTypes) {
    update.advertising_channel_types = args.advertisingChannelTypes;
    paths.push("advertising_channel_types");
  }
  if (args.conversionRateModifier != null) {
    update.conversion_rate_modifier = args.conversionRateModifier;
    paths.push("conversion_rate_modifier");
  }

  if (paths.length === 0) {
    throw new Error("At least one field is required for update_bidding_seasonality_adjustment.");
  }

  return runMutation(customer, [
    {
      bidding_seasonality_adjustment_operation: {
        update,
        update_mask: { paths },
      },
    },
  ]);
}

const RemoveBiddingSeasonalityAdjustmentSchema = BaseSchema.extend({
  seasonalityAdjustmentId: z.string().describe("Seasonality adjustment ID/resource name"),
});

async function removeBiddingSeasonalityAdjustment(
  args: z.infer<typeof RemoveBiddingSeasonalityAdjustmentSchema>
) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      bidding_seasonality_adjustment_operation: {
        remove: toSeasonalityAdjustmentResourceName(args.customerId, args.seasonalityAdjustmentId),
      },
    },
  ]);
}

const ListBiddingDataExclusionsSchema = BaseSchema.extend({
  limit: z.number().int().min(1).max(1000).default(100),
});

async function listBiddingDataExclusions(args: z.infer<typeof ListBiddingDataExclusionsSchema>) {
  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      bidding_data_exclusion.resource_name,
      bidding_data_exclusion.data_exclusion_id,
      bidding_data_exclusion.name,
      bidding_data_exclusion.status,
      bidding_data_exclusion.scope,
      bidding_data_exclusion.start_date_time,
      bidding_data_exclusion.end_date_time,
      bidding_data_exclusion.description,
      bidding_data_exclusion.devices,
      bidding_data_exclusion.campaigns,
      bidding_data_exclusion.advertising_channel_types
    FROM bidding_data_exclusion
    ORDER BY bidding_data_exclusion.data_exclusion_id DESC
    LIMIT ${args.limit}`,
  });
}

const CreateBiddingDataExclusionSchema = SeasonalityBaseSchema.extend({
  name: z.string().min(1),
  scope: z.enum(["CAMPAIGN", "CHANNEL", "CUSTOMER"]).default("CUSTOMER"),
  startDateTime: z.string().describe("YYYY-MM-DD HH:mm:ss+00:00"),
  endDateTime: z.string().describe("YYYY-MM-DD HH:mm:ss+00:00"),
});

async function createBiddingDataExclusion(args: z.infer<typeof CreateBiddingDataExclusionSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const create: Record<string, unknown> = {
    name: args.name,
    scope: args.scope,
    start_date_time: args.startDateTime,
    end_date_time: args.endDateTime,
  };

  if (args.status) {
    create.status = args.status;
  }
  if (args.description) {
    create.description = args.description;
  }
  if (args.devices && args.devices.length > 0) {
    create.devices = args.devices;
  }
  const campaignResourceNames = mapCampaignIdsToResourceNames(args.customerId, args.campaignIds);
  if (campaignResourceNames && campaignResourceNames.length > 0) {
    create.campaigns = campaignResourceNames;
  }
  if (args.advertisingChannelTypes && args.advertisingChannelTypes.length > 0) {
    create.advertising_channel_types = args.advertisingChannelTypes;
  }

  return runMutation(customer, [
    {
      bidding_data_exclusion_operation: {
        create,
      },
    },
  ]);
}

const UpdateBiddingDataExclusionSchema = SeasonalityBaseSchema.extend({
  dataExclusionId: z.string().describe("Data exclusion ID/resource name"),
});

async function updateBiddingDataExclusion(args: z.infer<typeof UpdateBiddingDataExclusionSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const update: Record<string, unknown> = {
    resource_name: toDataExclusionResourceName(args.customerId, args.dataExclusionId),
  };
  const paths: string[] = [];

  if (args.name) {
    update.name = args.name;
    paths.push("name");
  }
  if (args.scope) {
    update.scope = args.scope;
    paths.push("scope");
  }
  if (args.status) {
    update.status = args.status;
    paths.push("status");
  }
  if (args.startDateTime) {
    update.start_date_time = args.startDateTime;
    paths.push("start_date_time");
  }
  if (args.endDateTime) {
    update.end_date_time = args.endDateTime;
    paths.push("end_date_time");
  }
  if (args.description !== undefined) {
    update.description = args.description;
    paths.push("description");
  }
  if (args.devices) {
    update.devices = args.devices;
    paths.push("devices");
  }
  if (args.campaignIds) {
    update.campaigns = mapCampaignIdsToResourceNames(args.customerId, args.campaignIds);
    paths.push("campaigns");
  }
  if (args.advertisingChannelTypes) {
    update.advertising_channel_types = args.advertisingChannelTypes;
    paths.push("advertising_channel_types");
  }

  if (paths.length === 0) {
    throw new Error("At least one field is required for update_bidding_data_exclusion.");
  }

  return runMutation(customer, [
    {
      bidding_data_exclusion_operation: {
        update,
        update_mask: { paths },
      },
    },
  ]);
}

const RemoveBiddingDataExclusionSchema = BaseSchema.extend({
  dataExclusionId: z.string().describe("Data exclusion ID/resource name"),
});

async function removeBiddingDataExclusion(args: z.infer<typeof RemoveBiddingDataExclusionSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      bidding_data_exclusion_operation: {
        remove: toDataExclusionResourceName(args.customerId, args.dataExclusionId),
      },
    },
  ]);
}

async function asTool(fn: (args: any) => Promise<any>, args: any): Promise<{
  content: [{ type: "text"; text: string }];
  isError?: true;
}> {
  try {
    const result = await fn(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}

export function registerBiddingAdvancedTools(server: McpServer) {
  server.registerTool(
    "list_bidding_strategies",
    { description: "List portfolio bidding strategies.", inputSchema: ListBiddingStrategiesSchema.shape },
    args => asTool(listBiddingStrategies, args)
  );
  server.registerTool(
    "create_portfolio_bidding_strategy",
    {
      description: "Create a portfolio bidding strategy.",
      inputSchema: CreatePortfolioBiddingStrategySchema.shape,
    },
    args => asTool(createPortfolioBiddingStrategy, args)
  );
  server.registerTool(
    "update_portfolio_bidding_strategy",
    {
      description: "Update a portfolio bidding strategy.",
      inputSchema: UpdatePortfolioBiddingStrategySchema.shape,
    },
    args => asTool(updatePortfolioBiddingStrategy, args)
  );
  server.registerTool(
    "remove_portfolio_bidding_strategy",
    {
      description: "Remove a portfolio bidding strategy.",
      inputSchema: RemovePortfolioBiddingStrategySchema.shape,
    },
    args => asTool(removePortfolioBiddingStrategy, args)
  );
  server.registerTool(
    "set_campaign_portfolio_bidding_strategy",
    {
      description: "Assign a portfolio bidding strategy to a campaign.",
      inputSchema: SetCampaignPortfolioBiddingStrategySchema.shape,
    },
    args => asTool(setCampaignPortfolioBiddingStrategy, args)
  );
  server.registerTool(
    "clear_campaign_portfolio_bidding_strategy",
    {
      description: "Clear campaign portfolio bidding strategy by switching to manual CPC.",
      inputSchema: ClearCampaignPortfolioBiddingStrategySchema.shape,
    },
    args => asTool(clearCampaignPortfolioBiddingStrategy, args)
  );
  server.registerTool(
    "list_bidding_seasonality_adjustments",
    {
      description: "List bidding seasonality adjustments.",
      inputSchema: ListBiddingSeasonalityAdjustmentsSchema.shape,
    },
    args => asTool(listBiddingSeasonalityAdjustments, args)
  );
  server.registerTool(
    "create_bidding_seasonality_adjustment",
    {
      description: "Create a bidding seasonality adjustment.",
      inputSchema: CreateBiddingSeasonalityAdjustmentSchema.shape,
    },
    args => asTool(createBiddingSeasonalityAdjustment, args)
  );
  server.registerTool(
    "update_bidding_seasonality_adjustment",
    {
      description: "Update a bidding seasonality adjustment.",
      inputSchema: UpdateBiddingSeasonalityAdjustmentSchema.shape,
    },
    args => asTool(updateBiddingSeasonalityAdjustment, args)
  );
  server.registerTool(
    "remove_bidding_seasonality_adjustment",
    {
      description: "Remove a bidding seasonality adjustment.",
      inputSchema: RemoveBiddingSeasonalityAdjustmentSchema.shape,
    },
    args => asTool(removeBiddingSeasonalityAdjustment, args)
  );
  server.registerTool(
    "list_bidding_data_exclusions",
    {
      description: "List bidding data exclusions.",
      inputSchema: ListBiddingDataExclusionsSchema.shape,
    },
    args => asTool(listBiddingDataExclusions, args)
  );
  server.registerTool(
    "create_bidding_data_exclusion",
    {
      description: "Create a bidding data exclusion.",
      inputSchema: CreateBiddingDataExclusionSchema.shape,
    },
    args => asTool(createBiddingDataExclusion, args)
  );
  server.registerTool(
    "update_bidding_data_exclusion",
    {
      description: "Update a bidding data exclusion.",
      inputSchema: UpdateBiddingDataExclusionSchema.shape,
    },
    args => asTool(updateBiddingDataExclusion, args)
  );
  server.registerTool(
    "remove_bidding_data_exclusion",
    {
      description: "Remove a bidding data exclusion.",
      inputSchema: RemoveBiddingDataExclusionSchema.shape,
    },
    args => asTool(removeBiddingDataExclusion, args)
  );
}
