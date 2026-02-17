import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runQuery } from "./runQuery";

const BaseSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

const LimitedListSchema = BaseSchema.extend({
  limit: z.number().int().min(1).max(1000).default(100),
});

function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/-/g, "");
}

function escapeGaqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

function toResourceName(customerId: string, idOrResourceName: string, collection: string): string {
  if (idOrResourceName.startsWith("customers/")) {
    return idOrResourceName;
  }
  const customer = normalizeCustomerId(customerId);
  const id = normalizeNumericId(idOrResourceName, collection);
  return `customers/${customer}/${collection}/${id}`;
}

function firstRowResult(rows: unknown[]) {
  return {
    found: rows.length > 0,
    row: rows[0] ?? null,
  };
}

const GetCampaignSchema = BaseSchema.extend({
  campaignId: z.string().describe("Campaign ID or resource name"),
});

async function getCampaign(args: z.infer<typeof GetCampaignSchema>) {
  const resourceName = toResourceName(args.customerId, args.campaignId, "campaigns");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign.resource_name,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign.campaign_budget,
      campaign.start_date,
      campaign.end_date
    FROM campaign
    WHERE campaign.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const ListCampaignBudgetsSchema = LimitedListSchema.extend({
  status: z.enum(["ENABLED", "REMOVED"]).optional(),
});

async function listCampaignBudgets(args: z.infer<typeof ListCampaignBudgetsSchema>) {
  const where = args.status ? `WHERE campaign_budget.status = ${args.status}` : "";
  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_budget.resource_name,
      campaign_budget.id,
      campaign_budget.name,
      campaign_budget.amount_micros,
      campaign_budget.total_amount_micros,
      campaign_budget.explicitly_shared,
      campaign_budget.delivery_method,
      campaign_budget.status
    FROM campaign_budget
    ${where}
    ORDER BY campaign_budget.id DESC
    LIMIT ${args.limit}`,
  });
}

const GetCampaignBudgetSchema = BaseSchema.extend({
  budgetId: z.string().describe("Campaign budget ID or resource name"),
});

async function getCampaignBudget(args: z.infer<typeof GetCampaignBudgetSchema>) {
  const resourceName = toResourceName(args.customerId, args.budgetId, "campaignBudgets");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_budget.resource_name,
      campaign_budget.id,
      campaign_budget.name,
      campaign_budget.amount_micros,
      campaign_budget.total_amount_micros,
      campaign_budget.explicitly_shared,
      campaign_budget.delivery_method,
      campaign_budget.status
    FROM campaign_budget
    WHERE campaign_budget.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetAdGroupSchema = BaseSchema.extend({
  adGroupId: z.string().describe("Ad group ID or resource name"),
});

async function getAdGroup(args: z.infer<typeof GetAdGroupSchema>) {
  const resourceName = toResourceName(args.customerId, args.adGroupId, "adGroups");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      ad_group.resource_name,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.type,
      ad_group.cpc_bid_micros,
      campaign.id,
      campaign.name
    FROM ad_group
    WHERE ad_group.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetKeywordSchema = BaseSchema
  .extend({
    resourceName: z.string().optional().describe("ad_group_criterion resource name"),
    adGroupId: z.string().optional().describe("Ad group ID or resource name"),
    criterionId: z.string().optional().describe("Keyword criterion ID"),
  })
  .refine(args => Boolean(args.resourceName) || Boolean(args.adGroupId && args.criterionId), {
    message: "Provide resourceName or adGroupId+criterionId.",
  });

async function getKeyword(args: z.infer<typeof GetKeywordSchema>) {
  const filters: string[] = [];
  if (args.resourceName) {
    filters.push(`ad_group_criterion.resource_name = '${escapeGaqlString(args.resourceName)}'`);
  } else {
    const adGroupId = normalizeNumericId(args.adGroupId!, "adGroups");
    const criterionId = args.criterionId!.replace(/[^0-9]/g, "");
    if (!criterionId) {
      throw new Error("Invalid criterionId.");
    }
    filters.push(`ad_group.id = ${adGroupId}`);
    filters.push(`ad_group_criterion.criterion_id = ${criterionId}`);
  }
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.status,
      ad_group_criterion.negative,
      ad_group_criterion.cpc_bid_micros,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name
    FROM keyword_view
    WHERE ${filters.join(" AND ")}
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetAdSchema = BaseSchema
  .extend({
    resourceName: z.string().optional().describe("ad_group_ad resource name"),
    adGroupId: z.string().optional().describe("Ad group ID or resource name"),
    adId: z.string().optional().describe("Ad ID"),
  })
  .refine(args => Boolean(args.resourceName) || Boolean(args.adGroupId && args.adId), {
    message: "Provide resourceName or adGroupId+adId.",
  });

async function getAd(args: z.infer<typeof GetAdSchema>) {
  const filters: string[] = [];
  if (args.resourceName) {
    filters.push(`ad_group_ad.resource_name = '${escapeGaqlString(args.resourceName)}'`);
  } else {
    const adGroupId = normalizeNumericId(args.adGroupId!, "adGroups");
    const adId = args.adId!.replace(/[^0-9]/g, "");
    if (!adId) {
      throw new Error("Invalid adId.");
    }
    filters.push(`ad_group.id = ${adGroupId}`);
    filters.push(`ad_group_ad.ad.id = ${adId}`);
  }
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      ad_group_ad.resource_name,
      ad_group_ad.status,
      ad_group_ad.ad.id,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.path1,
      ad_group_ad.ad.responsive_search_ad.path2,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name
    FROM ad_group_ad
    WHERE ${filters.join(" AND ")}
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetAssetSchema = BaseSchema.extend({
  assetId: z.string().describe("Asset ID or resource name"),
});

async function getAsset(args: z.infer<typeof GetAssetSchema>) {
  const resourceName = toResourceName(args.customerId, args.assetId, "assets");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      asset.resource_name,
      asset.id,
      asset.name,
      asset.type,
      asset.final_urls,
      asset.source
    FROM asset
    WHERE asset.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetAssetGroupSchema = BaseSchema.extend({
  assetGroupId: z.string().describe("Asset group ID or resource name"),
});

async function getAssetGroup(args: z.infer<typeof GetAssetGroupSchema>) {
  const resourceName = toResourceName(args.customerId, args.assetGroupId, "assetGroups");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      asset_group.resource_name,
      asset_group.id,
      asset_group.name,
      asset_group.status,
      asset_group.campaign,
      asset_group.final_urls,
      asset_group.path1,
      asset_group.path2
    FROM asset_group
    WHERE asset_group.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const ListCampaignNegativeKeywordsSchema = LimitedListSchema.extend({
  campaignId: z.string().optional().describe("Optional campaign ID or resource name"),
});

async function listCampaignNegativeKeywords(args: z.infer<typeof ListCampaignNegativeKeywordsSchema>) {
  const filters = ["campaign_criterion.negative = true", "campaign_criterion.type = KEYWORD"];
  if (args.campaignId) {
    const campaignId = normalizeNumericId(args.campaignId, "campaigns");
    filters.push(`campaign.id = ${campaignId}`);
  }
  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_criterion.resource_name,
      campaign_criterion.criterion_id,
      campaign_criterion.status,
      campaign_criterion.keyword.text,
      campaign_criterion.keyword.match_type,
      campaign.id,
      campaign.name
    FROM campaign_criterion
    WHERE ${filters.join(" AND ")}
    ORDER BY campaign_criterion.criterion_id DESC
    LIMIT ${args.limit}`,
  });
}

const GetCampaignNegativeKeywordSchema = BaseSchema
  .extend({
    resourceName: z.string().optional().describe("campaign_criterion resource name"),
    campaignId: z.string().optional().describe("Campaign ID or resource name"),
    criterionId: z.string().optional().describe("Campaign criterion ID"),
  })
  .refine(args => Boolean(args.resourceName) || Boolean(args.campaignId && args.criterionId), {
    message: "Provide resourceName or campaignId+criterionId.",
  });

async function getCampaignNegativeKeyword(args: z.infer<typeof GetCampaignNegativeKeywordSchema>) {
  const filters = ["campaign_criterion.negative = true", "campaign_criterion.type = KEYWORD"];
  if (args.resourceName) {
    filters.push(`campaign_criterion.resource_name = '${escapeGaqlString(args.resourceName)}'`);
  } else {
    const campaignId = normalizeNumericId(args.campaignId!, "campaigns");
    const criterionId = args.criterionId!.replace(/[^0-9]/g, "");
    if (!criterionId) {
      throw new Error("Invalid criterionId.");
    }
    filters.push(`campaign.id = ${campaignId}`);
    filters.push(`campaign_criterion.criterion_id = ${criterionId}`);
  }
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_criterion.resource_name,
      campaign_criterion.criterion_id,
      campaign_criterion.status,
      campaign_criterion.keyword.text,
      campaign_criterion.keyword.match_type,
      campaign.id,
      campaign.name
    FROM campaign_criterion
    WHERE ${filters.join(" AND ")}
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const ListAdGroupNegativeKeywordsSchema = LimitedListSchema.extend({
  adGroupId: z.string().optional().describe("Optional ad group ID or resource name"),
});

async function listAdGroupNegativeKeywords(args: z.infer<typeof ListAdGroupNegativeKeywordsSchema>) {
  const filters = ["ad_group_criterion.negative = true", "ad_group_criterion.type = KEYWORD"];
  if (args.adGroupId) {
    const adGroupId = normalizeNumericId(args.adGroupId, "adGroups");
    filters.push(`ad_group.id = ${adGroupId}`);
  }
  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.status,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name
    FROM ad_group_criterion
    WHERE ${filters.join(" AND ")}
    ORDER BY ad_group_criterion.criterion_id DESC
    LIMIT ${args.limit}`,
  });
}

const GetAdGroupNegativeKeywordSchema = BaseSchema
  .extend({
    resourceName: z.string().optional().describe("ad_group_criterion resource name"),
    adGroupId: z.string().optional().describe("Ad group ID or resource name"),
    criterionId: z.string().optional().describe("Ad group criterion ID"),
  })
  .refine(args => Boolean(args.resourceName) || Boolean(args.adGroupId && args.criterionId), {
    message: "Provide resourceName or adGroupId+criterionId.",
  });

async function getAdGroupNegativeKeyword(args: z.infer<typeof GetAdGroupNegativeKeywordSchema>) {
  const filters = ["ad_group_criterion.negative = true", "ad_group_criterion.type = KEYWORD"];
  if (args.resourceName) {
    filters.push(`ad_group_criterion.resource_name = '${escapeGaqlString(args.resourceName)}'`);
  } else {
    const adGroupId = normalizeNumericId(args.adGroupId!, "adGroups");
    const criterionId = args.criterionId!.replace(/[^0-9]/g, "");
    if (!criterionId) {
      throw new Error("Invalid criterionId.");
    }
    filters.push(`ad_group.id = ${adGroupId}`);
    filters.push(`ad_group_criterion.criterion_id = ${criterionId}`);
  }
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.status,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name
    FROM ad_group_criterion
    WHERE ${filters.join(" AND ")}
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetSharedNegativeKeywordListSchema = BaseSchema.extend({
  sharedSetId: z.string().describe("Shared set ID or resource name"),
});

async function getSharedNegativeKeywordList(args: z.infer<typeof GetSharedNegativeKeywordListSchema>) {
  const resourceName = toResourceName(args.customerId, args.sharedSetId, "sharedSets");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      shared_set.resource_name,
      shared_set.id,
      shared_set.name,
      shared_set.type,
      shared_set.status
    FROM shared_set
    WHERE shared_set.type = NEGATIVE_KEYWORDS
      AND shared_set.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetConversionActionSchema = BaseSchema.extend({
  conversionActionId: z.string().describe("Conversion action ID or resource name"),
});

async function getConversionAction(args: z.infer<typeof GetConversionActionSchema>) {
  const resourceName = toResourceName(args.customerId, args.conversionActionId, "conversionActions");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      conversion_action.resource_name,
      conversion_action.id,
      conversion_action.name,
      conversion_action.status,
      conversion_action.type,
      conversion_action.category,
      conversion_action.include_in_conversions_metric
    FROM conversion_action
    WHERE conversion_action.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetCustomerConversionGoalSchema = BaseSchema
  .extend({
    resourceName: z.string().optional(),
    category: z.string().optional(),
    origin: z.string().optional(),
  })
  .refine(args => Boolean(args.resourceName) || Boolean(args.category && args.origin), {
    message: "Provide resourceName or category+origin.",
  });

function customerConversionGoalResourceName(customerId: string, category: string, origin: string): string {
  return `customers/${normalizeCustomerId(customerId)}/customerConversionGoals/${category}~${origin}`;
}

async function getCustomerConversionGoal(args: z.infer<typeof GetCustomerConversionGoalSchema>) {
  const resourceName =
    args.resourceName || customerConversionGoalResourceName(args.customerId, args.category!, args.origin!);
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      customer_conversion_goal.resource_name,
      customer_conversion_goal.category,
      customer_conversion_goal.origin,
      customer_conversion_goal.biddable
    FROM customer_conversion_goal
    WHERE customer_conversion_goal.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetCampaignConversionGoalSchema = BaseSchema
  .extend({
    resourceName: z.string().optional(),
    campaignId: z.string().optional(),
    category: z.string().optional(),
    origin: z.string().optional(),
  })
  .refine(args => Boolean(args.resourceName) || Boolean(args.campaignId && args.category && args.origin), {
    message: "Provide resourceName or campaignId+category+origin.",
  });

function campaignConversionGoalResourceName(
  customerId: string,
  campaignId: string,
  category: string,
  origin: string
): string {
  const cid = normalizeNumericId(campaignId, "campaigns");
  return `customers/${normalizeCustomerId(customerId)}/campaignConversionGoals/${cid}~${category}~${origin}`;
}

async function getCampaignConversionGoal(args: z.infer<typeof GetCampaignConversionGoalSchema>) {
  const resourceName =
    args.resourceName ||
    campaignConversionGoalResourceName(args.customerId, args.campaignId!, args.category!, args.origin!);
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_conversion_goal.resource_name,
      campaign_conversion_goal.campaign,
      campaign_conversion_goal.category,
      campaign_conversion_goal.origin,
      campaign_conversion_goal.biddable,
      campaign.id,
      campaign.name
    FROM campaign_conversion_goal
    WHERE campaign_conversion_goal.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetUserListSchema = BaseSchema.extend({
  userListId: z.string().describe("User list ID or resource name"),
});

async function getUserList(args: z.infer<typeof GetUserListSchema>) {
  const resourceName = toResourceName(args.customerId, args.userListId, "userLists");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      user_list.resource_name,
      user_list.id,
      user_list.name,
      user_list.description,
      user_list.membership_status,
      user_list.membership_life_span,
      user_list.size_for_display,
      user_list.size_for_search
    FROM user_list
    WHERE user_list.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetCustomAudienceSchema = BaseSchema.extend({
  customAudienceId: z.string().describe("Custom audience ID or resource name"),
});

async function getCustomAudience(args: z.infer<typeof GetCustomAudienceSchema>) {
  const resourceName = toResourceName(args.customerId, args.customAudienceId, "customAudiences");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      custom_audience.resource_name,
      custom_audience.id,
      custom_audience.name,
      custom_audience.description,
      custom_audience.status,
      custom_audience.type
    FROM custom_audience
    WHERE custom_audience.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetCombinedAudienceSchema = BaseSchema.extend({
  combinedAudienceId: z.string().describe("Combined audience ID or resource name"),
});

async function getCombinedAudience(args: z.infer<typeof GetCombinedAudienceSchema>) {
  const resourceName = toResourceName(args.customerId, args.combinedAudienceId, "combinedAudiences");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      combined_audience.resource_name,
      combined_audience.id,
      combined_audience.name,
      combined_audience.description,
      combined_audience.status
    FROM combined_audience
    WHERE combined_audience.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const ListCampaignAudienceTargetingSchema = LimitedListSchema.extend({
  campaignId: z.string().optional().describe("Optional campaign ID or resource name"),
});

async function listCampaignAudienceTargeting(args: z.infer<typeof ListCampaignAudienceTargetingSchema>) {
  const filters = [
    "campaign_criterion.type IN ('AUDIENCE','CUSTOM_AUDIENCE','COMBINED_AUDIENCE','USER_LIST')",
  ];
  if (args.campaignId) {
    const campaignId = normalizeNumericId(args.campaignId, "campaigns");
    filters.push(`campaign.id = ${campaignId}`);
  }
  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_criterion.resource_name,
      campaign_criterion.criterion_id,
      campaign_criterion.type,
      campaign_criterion.negative,
      campaign.id,
      campaign.name
    FROM campaign_criterion
    WHERE ${filters.join(" AND ")}
    ORDER BY campaign_criterion.criterion_id DESC
    LIMIT ${args.limit}`,
  });
}

const ListAdGroupAudienceTargetingSchema = LimitedListSchema.extend({
  adGroupId: z.string().optional().describe("Optional ad group ID or resource name"),
});

async function listAdGroupAudienceTargeting(args: z.infer<typeof ListAdGroupAudienceTargetingSchema>) {
  const filters = [
    "ad_group_criterion.type IN ('AUDIENCE','CUSTOM_AUDIENCE','COMBINED_AUDIENCE','USER_LIST')",
  ];
  if (args.adGroupId) {
    const adGroupId = normalizeNumericId(args.adGroupId, "adGroups");
    filters.push(`ad_group.id = ${adGroupId}`);
  }
  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.type,
      ad_group_criterion.negative,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name
    FROM ad_group_criterion
    WHERE ${filters.join(" AND ")}
    ORDER BY ad_group_criterion.criterion_id DESC
    LIMIT ${args.limit}`,
  });
}

const GetCampaignDraftSchema = BaseSchema.extend({
  draftId: z.string().describe("Campaign draft ID or resource name"),
});

async function getCampaignDraft(args: z.infer<typeof GetCampaignDraftSchema>) {
  const resourceName = toResourceName(args.customerId, args.draftId, "campaignDrafts");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_draft.resource_name,
      campaign_draft.draft_id,
      campaign_draft.base_campaign,
      campaign_draft.name,
      campaign_draft.draft_campaign,
      campaign_draft.status,
      campaign_draft.has_experiment_running,
      campaign_draft.long_running_operation
    FROM campaign_draft
    WHERE campaign_draft.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetBiddingStrategySchema = BaseSchema.extend({
  biddingStrategyId: z.string().describe("Bidding strategy ID or resource name"),
});

async function getBiddingStrategy(args: z.infer<typeof GetBiddingStrategySchema>) {
  const resourceName = toResourceName(args.customerId, args.biddingStrategyId, "biddingStrategies");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
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
      bidding_strategy.non_removed_campaign_count
    FROM bidding_strategy
    WHERE bidding_strategy.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetBiddingSeasonalityAdjustmentSchema = BaseSchema.extend({
  seasonalityAdjustmentId: z.string().describe("Seasonality adjustment ID or resource name"),
});

async function getBiddingSeasonalityAdjustment(args: z.infer<typeof GetBiddingSeasonalityAdjustmentSchema>) {
  const resourceName = toResourceName(
    args.customerId,
    args.seasonalityAdjustmentId,
    "biddingSeasonalityAdjustments"
  );
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
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
      bidding_seasonality_adjustment.conversion_rate_modifier
    FROM bidding_seasonality_adjustment
    WHERE bidding_seasonality_adjustment.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetBiddingDataExclusionSchema = BaseSchema.extend({
  dataExclusionId: z.string().describe("Data exclusion ID or resource name"),
});

async function getBiddingDataExclusion(args: z.infer<typeof GetBiddingDataExclusionSchema>) {
  const resourceName = toResourceName(args.customerId, args.dataExclusionId, "biddingDataExclusions");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      bidding_data_exclusion.resource_name,
      bidding_data_exclusion.data_exclusion_id,
      bidding_data_exclusion.name,
      bidding_data_exclusion.status,
      bidding_data_exclusion.scope,
      bidding_data_exclusion.start_date_time,
      bidding_data_exclusion.end_date_time
    FROM bidding_data_exclusion
    WHERE bidding_data_exclusion.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetAssetSetSchema = BaseSchema.extend({
  assetSetId: z.string().describe("Asset set ID or resource name"),
});

async function getAssetSet(args: z.infer<typeof GetAssetSetSchema>) {
  const resourceName = toResourceName(args.customerId, args.assetSetId, "assetSets");
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      asset_set.resource_name,
      asset_set.id,
      asset_set.name,
      asset_set.type,
      asset_set.status
    FROM asset_set
    WHERE asset_set.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetAssetSetAssetSchema = BaseSchema
  .extend({
    resourceName: z.string().optional().describe("asset_set_asset resource name"),
    assetSetId: z.string().optional().describe("Asset set ID or resource name"),
    assetId: z.string().optional().describe("Asset ID or resource name"),
  })
  .refine(args => Boolean(args.resourceName) || Boolean(args.assetSetId && args.assetId), {
    message: "Provide resourceName or assetSetId+assetId.",
  });

function assetSetAssetResourceName(customerId: string, assetSetId: string, assetId: string): string {
  const customer = normalizeCustomerId(customerId);
  const setId = normalizeNumericId(assetSetId, "assetSets");
  const normalizedAssetId = normalizeNumericId(assetId, "assets");
  return `customers/${customer}/assetSetAssets/${setId}~${normalizedAssetId}`;
}

async function getAssetSetAsset(args: z.infer<typeof GetAssetSetAssetSchema>) {
  const resourceName =
    args.resourceName || assetSetAssetResourceName(args.customerId, args.assetSetId!, args.assetId!);
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      asset_set_asset.resource_name,
      asset_set_asset.asset_set,
      asset_set_asset.asset,
      asset_set_asset.status
    FROM asset_set_asset
    WHERE asset_set_asset.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetCampaignAssetSetSchema = BaseSchema
  .extend({
    resourceName: z.string().optional().describe("campaign_asset_set resource name"),
    campaignId: z.string().optional().describe("Campaign ID or resource name"),
    assetSetId: z.string().optional().describe("Asset set ID or resource name"),
  })
  .refine(args => Boolean(args.resourceName) || Boolean(args.campaignId && args.assetSetId), {
    message: "Provide resourceName or campaignId+assetSetId.",
  });

function campaignAssetSetResourceName(customerId: string, campaignId: string, assetSetId: string): string {
  const customer = normalizeCustomerId(customerId);
  const cId = normalizeNumericId(campaignId, "campaigns");
  const setId = normalizeNumericId(assetSetId, "assetSets");
  return `customers/${customer}/campaignAssetSets/${cId}~${setId}`;
}

async function getCampaignAssetSet(args: z.infer<typeof GetCampaignAssetSetSchema>) {
  const resourceName =
    args.resourceName ||
    campaignAssetSetResourceName(args.customerId, args.campaignId!, args.assetSetId!);
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_asset_set.resource_name,
      campaign_asset_set.campaign,
      campaign_asset_set.asset_set,
      campaign_asset_set.status
    FROM campaign_asset_set
    WHERE campaign_asset_set.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetAssetGroupSignalSchema = BaseSchema.extend({
  resourceName: z.string().describe("Asset group signal resource name"),
});

async function getAssetGroupSignal(args: z.infer<typeof GetAssetGroupSignalSchema>) {
  const escaped = escapeGaqlString(args.resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      asset_group_signal.resource_name,
      asset_group_signal.asset_group,
      asset_group_signal.approval_status,
      asset_group_signal.disapproval_reasons,
      asset_group_signal.audience,
      asset_group_signal.search_theme
    FROM asset_group_signal
    WHERE asset_group_signal.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const GetExperimentSchema = BaseSchema.extend({
  experimentId: z.string().describe("Experiment ID or resource name"),
});

async function getExperiment(args: z.infer<typeof GetExperimentSchema>) {
  const resourceName = args.experimentId.startsWith("customers/")
    ? args.experimentId
    : `customers/${normalizeCustomerId(args.customerId)}/experiments/${args.experimentId.trim()}`;
  const escaped = escapeGaqlString(resourceName);
  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      experiment.resource_name,
      experiment.experiment_id,
      experiment.name,
      experiment.suffix,
      experiment.type,
      experiment.status,
      experiment.start_date,
      experiment.end_date
    FROM experiment
    WHERE experiment.resource_name = '${escaped}'
    LIMIT 1`,
  });
  return firstRowResult(rows);
}

const ListReachPlannableProductsSchema = BaseSchema.extend({
  locationId: z.string().describe("Plannable location ID."),
});

async function listReachPlannableProducts(args: z.infer<typeof ListReachPlannableProductsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  return (customer as any).reachPlans.listPlannableProducts({
    plannable_location_id: args.locationId,
  });
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

export const READ_PARITY_EXPECTED_TOOL_NAMES: string[] = [
  "get_campaign",
  "list_campaign_budgets",
  "get_campaign_budget",
  "get_ad_group",
  "get_keyword",
  "get_ad",
  "get_asset",
  "get_asset_group",
  "list_campaign_negative_keywords",
  "get_campaign_negative_keyword",
  "list_ad_group_negative_keywords",
  "get_ad_group_negative_keyword",
  "get_shared_negative_keyword_list",
  "get_conversion_action",
  "get_customer_conversion_goal",
  "get_campaign_conversion_goal",
  "get_user_list",
  "get_custom_audience",
  "get_combined_audience",
  "list_campaign_audience_targeting",
  "list_ad_group_audience_targeting",
  "get_campaign_draft",
  "get_bidding_strategy",
  "get_bidding_seasonality_adjustment",
  "get_bidding_data_exclusion",
  "get_asset_set",
  "get_asset_set_asset",
  "get_campaign_asset_set",
  "get_asset_group_signal",
  "get_experiment",
  "list_reach_plannable_products",
];

export function registerReadParityTools(server: McpServer) {
  server.registerTool("get_campaign", { description: "Get one campaign.", inputSchema: GetCampaignSchema.shape }, args =>
    asTool(getCampaign, args)
  );
  server.registerTool(
    "list_campaign_budgets",
    { description: "List campaign budgets.", inputSchema: ListCampaignBudgetsSchema.shape },
    args => asTool(listCampaignBudgets, args)
  );
  server.registerTool(
    "get_campaign_budget",
    { description: "Get one campaign budget.", inputSchema: GetCampaignBudgetSchema.shape },
    args => asTool(getCampaignBudget, args)
  );
  server.registerTool("get_ad_group", { description: "Get one ad group.", inputSchema: GetAdGroupSchema.shape }, args =>
    asTool(getAdGroup, args)
  );
  server.registerTool("get_keyword", { description: "Get one keyword.", inputSchema: GetKeywordSchema.shape }, args =>
    asTool(getKeyword, args)
  );
  server.registerTool("get_ad", { description: "Get one ad.", inputSchema: GetAdSchema.shape }, args =>
    asTool(getAd, args)
  );
  server.registerTool("get_asset", { description: "Get one asset.", inputSchema: GetAssetSchema.shape }, args =>
    asTool(getAsset, args)
  );
  server.registerTool(
    "get_asset_group",
    { description: "Get one asset group.", inputSchema: GetAssetGroupSchema.shape },
    args => asTool(getAssetGroup, args)
  );
  server.registerTool(
    "list_campaign_negative_keywords",
    { description: "List campaign-level negative keywords.", inputSchema: ListCampaignNegativeKeywordsSchema.shape },
    args => asTool(listCampaignNegativeKeywords, args)
  );
  server.registerTool(
    "get_campaign_negative_keyword",
    { description: "Get one campaign-level negative keyword.", inputSchema: GetCampaignNegativeKeywordSchema.shape },
    args => asTool(getCampaignNegativeKeyword, args)
  );
  server.registerTool(
    "list_ad_group_negative_keywords",
    { description: "List ad-group-level negative keywords.", inputSchema: ListAdGroupNegativeKeywordsSchema.shape },
    args => asTool(listAdGroupNegativeKeywords, args)
  );
  server.registerTool(
    "get_ad_group_negative_keyword",
    { description: "Get one ad-group-level negative keyword.", inputSchema: GetAdGroupNegativeKeywordSchema.shape },
    args => asTool(getAdGroupNegativeKeyword, args)
  );
  server.registerTool(
    "get_shared_negative_keyword_list",
    { description: "Get one shared negative keyword list.", inputSchema: GetSharedNegativeKeywordListSchema.shape },
    args => asTool(getSharedNegativeKeywordList, args)
  );
  server.registerTool(
    "get_conversion_action",
    { description: "Get one conversion action.", inputSchema: GetConversionActionSchema.shape },
    args => asTool(getConversionAction, args)
  );
  server.registerTool(
    "get_customer_conversion_goal",
    { description: "Get one customer conversion goal.", inputSchema: GetCustomerConversionGoalSchema.shape },
    args => asTool(getCustomerConversionGoal, args)
  );
  server.registerTool(
    "get_campaign_conversion_goal",
    { description: "Get one campaign conversion goal.", inputSchema: GetCampaignConversionGoalSchema.shape },
    args => asTool(getCampaignConversionGoal, args)
  );
  server.registerTool("get_user_list", { description: "Get one user list.", inputSchema: GetUserListSchema.shape }, args =>
    asTool(getUserList, args)
  );
  server.registerTool(
    "get_custom_audience",
    { description: "Get one custom audience.", inputSchema: GetCustomAudienceSchema.shape },
    args => asTool(getCustomAudience, args)
  );
  server.registerTool(
    "get_combined_audience",
    { description: "Get one combined audience.", inputSchema: GetCombinedAudienceSchema.shape },
    args => asTool(getCombinedAudience, args)
  );
  server.registerTool(
    "list_campaign_audience_targeting",
    { description: "List campaign audience targeting criteria.", inputSchema: ListCampaignAudienceTargetingSchema.shape },
    args => asTool(listCampaignAudienceTargeting, args)
  );
  server.registerTool(
    "list_ad_group_audience_targeting",
    { description: "List ad-group audience targeting criteria.", inputSchema: ListAdGroupAudienceTargetingSchema.shape },
    args => asTool(listAdGroupAudienceTargeting, args)
  );
  server.registerTool(
    "get_campaign_draft",
    { description: "Get one campaign draft.", inputSchema: GetCampaignDraftSchema.shape },
    args => asTool(getCampaignDraft, args)
  );
  server.registerTool(
    "get_bidding_strategy",
    { description: "Get one bidding strategy.", inputSchema: GetBiddingStrategySchema.shape },
    args => asTool(getBiddingStrategy, args)
  );
  server.registerTool(
    "get_bidding_seasonality_adjustment",
    {
      description: "Get one bidding seasonality adjustment.",
      inputSchema: GetBiddingSeasonalityAdjustmentSchema.shape,
    },
    args => asTool(getBiddingSeasonalityAdjustment, args)
  );
  server.registerTool(
    "get_bidding_data_exclusion",
    { description: "Get one bidding data exclusion.", inputSchema: GetBiddingDataExclusionSchema.shape },
    args => asTool(getBiddingDataExclusion, args)
  );
  server.registerTool("get_asset_set", { description: "Get one asset set.", inputSchema: GetAssetSetSchema.shape }, args =>
    asTool(getAssetSet, args)
  );
  server.registerTool(
    "get_asset_set_asset",
    { description: "Get one asset-set asset link.", inputSchema: GetAssetSetAssetSchema.shape },
    args => asTool(getAssetSetAsset, args)
  );
  server.registerTool(
    "get_campaign_asset_set",
    { description: "Get one campaign asset-set link.", inputSchema: GetCampaignAssetSetSchema.shape },
    args => asTool(getCampaignAssetSet, args)
  );
  server.registerTool(
    "get_asset_group_signal",
    { description: "Get one asset-group signal.", inputSchema: GetAssetGroupSignalSchema.shape },
    args => asTool(getAssetGroupSignal, args)
  );
  server.registerTool(
    "get_experiment",
    { description: "Get one experiment.", inputSchema: GetExperimentSchema.shape },
    args => asTool(getExperiment, args)
  );
  server.registerTool(
    "list_reach_plannable_products",
    { description: "List reach plannable products for a location.", inputSchema: ListReachPlannableProductsSchema.shape },
    args => asTool(listReachPlannableProducts, args)
  );
}
