import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";

const BaseSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

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

function toAssetSetResourceName(customerId: string, assetSetIdOrResourceName: string): string {
  if (assetSetIdOrResourceName.startsWith("customers/")) {
    return assetSetIdOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const assetSetId = normalizeNumericId(assetSetIdOrResourceName, "assetSets");
  return `customers/${normalizedCustomerId}/assetSets/${assetSetId}`;
}

function toAssetResourceName(customerId: string, assetIdOrResourceName: string): string {
  if (assetIdOrResourceName.startsWith("customers/")) {
    return assetIdOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const assetId = normalizeNumericId(assetIdOrResourceName, "assets");
  return `customers/${normalizedCustomerId}/assets/${assetId}`;
}

function toCampaignResourceName(customerId: string, campaignIdOrResourceName: string): string {
  if (campaignIdOrResourceName.startsWith("customers/")) {
    return campaignIdOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const campaignId = normalizeNumericId(campaignIdOrResourceName, "campaigns");
  return `customers/${normalizedCustomerId}/campaigns/${campaignId}`;
}

function toAssetGroupResourceName(customerId: string, assetGroupIdOrResourceName: string): string {
  if (assetGroupIdOrResourceName.startsWith("customers/")) {
    return assetGroupIdOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const assetGroupId = normalizeNumericId(assetGroupIdOrResourceName, "assetGroups");
  return `customers/${normalizedCustomerId}/assetGroups/${assetGroupId}`;
}

function toAssetSetAssetResourceName(
  customerId: string,
  assetSetIdOrResourceName: string,
  assetIdOrResourceName: string
): string {
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const assetSetId = normalizeNumericId(assetSetIdOrResourceName, "assetSets");
  const assetId = normalizeNumericId(assetIdOrResourceName, "assets");
  return `customers/${normalizedCustomerId}/assetSetAssets/${assetSetId}~${assetId}`;
}

function toCampaignAssetSetResourceName(
  customerId: string,
  campaignIdOrResourceName: string,
  assetSetIdOrResourceName: string
): string {
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const campaignId = normalizeNumericId(campaignIdOrResourceName, "campaigns");
  const assetSetId = normalizeNumericId(assetSetIdOrResourceName, "assetSets");
  return `customers/${normalizedCustomerId}/campaignAssetSets/${campaignId}~${assetSetId}`;
}

function toAudienceResourceName(customerId: string, audienceIdOrResourceName: string): string {
  if (audienceIdOrResourceName.startsWith("customers/")) {
    return audienceIdOrResourceName;
  }
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const audienceId = normalizeNumericId(audienceIdOrResourceName, "audiences");
  return `customers/${normalizedCustomerId}/audiences/${audienceId}`;
}

const ListAssetSetsSchema = BaseSchema.extend({
  type: z.string().optional().describe("Optional AssetSetType enum filter"),
  status: z.string().optional().describe("Optional AssetSetStatus enum filter"),
  limit: z.number().int().min(1).max(1000).default(100),
});

async function listAssetSets(args: z.infer<typeof ListAssetSetsSchema>) {
  const filters: string[] = [];
  if (args.type) {
    filters.push(`asset_set.type = ${args.type}`);
  }
  if (args.status) {
    filters.push(`asset_set.status = ${args.status}`);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      asset_set.resource_name,
      asset_set.id,
      asset_set.name,
      asset_set.type,
      asset_set.status,
      asset_set.location_group_parent_asset_set_id
    FROM asset_set
    ${where}
    ORDER BY asset_set.id DESC
    LIMIT ${args.limit}`,
  });
}

const CreateAssetSetSchema = BaseSchema.extend({
  name: z.string().min(1),
  type: z.string().describe("Google Ads AssetSetType enum value (e.g. BUSINESS_PROFILE_LOCATION, PAGE_FEED)"),
  status: z.enum(["ENABLED", "REMOVED"]).default("ENABLED"),
});

async function createAssetSet(args: z.infer<typeof CreateAssetSetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      asset_set_operation: {
        create: {
          name: args.name,
          type: args.type,
          status: args.status,
        },
      },
    },
  ]);
}

const UpdateAssetSetSchema = BaseSchema.extend({
  assetSetId: z.string().describe("Asset set ID/resource name"),
  name: z.string().min(1).optional(),
  status: z.enum(["ENABLED", "REMOVED"]).optional(),
});

async function updateAssetSet(args: z.infer<typeof UpdateAssetSetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const update: Record<string, unknown> = {
    resource_name: toAssetSetResourceName(args.customerId, args.assetSetId),
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

  if (paths.length === 0) {
    throw new Error("At least one field is required for update_asset_set.");
  }

  return runMutation(customer, [
    {
      asset_set_operation: {
        update,
        update_mask: { paths },
      },
    },
  ]);
}

const RemoveAssetSetSchema = BaseSchema.extend({
  assetSetId: z.string().describe("Asset set ID/resource name"),
});

async function removeAssetSet(args: z.infer<typeof RemoveAssetSetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      asset_set_operation: {
        remove: toAssetSetResourceName(args.customerId, args.assetSetId),
      },
    },
  ]);
}

const ListAssetSetAssetsSchema = BaseSchema.extend({
  assetSetId: z.string().optional().describe("Optional asset set ID/resource name filter"),
  limit: z.number().int().min(1).max(1000).default(200),
});

async function listAssetSetAssets(args: z.infer<typeof ListAssetSetAssetsSchema>) {
  const assetSetFilter = args.assetSetId
    ? `WHERE asset_set_asset.asset_set = '${toAssetSetResourceName(args.customerId, args.assetSetId)}'`
    : "";

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      asset_set_asset.resource_name,
      asset_set_asset.asset_set,
      asset_set_asset.asset,
      asset_set_asset.status,
      asset_set.id,
      asset_set.name,
      asset.id,
      asset.name,
      asset.type
    FROM asset_set_asset
    ${assetSetFilter}
    ORDER BY asset_set_asset.resource_name DESC
    LIMIT ${args.limit}`,
  });
}

const LinkAssetSetAssetSchema = BaseSchema.extend({
  assetSetId: z.string().describe("Asset set ID/resource name"),
  assetId: z.string().describe("Asset ID/resource name"),
  status: z.enum(["ENABLED", "REMOVED"]).default("ENABLED"),
});

async function linkAssetSetAsset(args: z.infer<typeof LinkAssetSetAssetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      asset_set_asset_operation: {
        create: {
          asset_set: toAssetSetResourceName(args.customerId, args.assetSetId),
          asset: toAssetResourceName(args.customerId, args.assetId),
          status: args.status,
        },
      },
    },
  ]);
}

const UnlinkAssetSetAssetSchema = BaseSchema.extend({
  resourceName: z.string().optional().describe("customers/{customerId}/assetSetAssets/{assetSetId}~{assetId}"),
  assetSetId: z.string().optional().describe("Asset set ID/resource name"),
  assetId: z.string().optional().describe("Asset ID/resource name"),
}).refine(args => Boolean(args.resourceName) || Boolean(args.assetSetId && args.assetId), {
  message: "Provide resourceName or assetSetId+assetId.",
});

async function unlinkAssetSetAsset(args: z.infer<typeof UnlinkAssetSetAssetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName =
    args.resourceName || toAssetSetAssetResourceName(args.customerId, args.assetSetId!, args.assetId!);

  return runMutation(customer, [
    {
      asset_set_asset_operation: {
        remove: resourceName,
      },
    },
  ]);
}

const ListCampaignAssetSetsSchema = BaseSchema.extend({
  campaignId: z.string().optional().describe("Optional campaign ID/resource name filter"),
  limit: z.number().int().min(1).max(1000).default(200),
});

async function listCampaignAssetSets(args: z.infer<typeof ListCampaignAssetSetsSchema>) {
  const campaignFilter = args.campaignId
    ? `WHERE campaign_asset_set.campaign = '${toCampaignResourceName(args.customerId, args.campaignId)}'`
    : "";

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_asset_set.resource_name,
      campaign_asset_set.campaign,
      campaign_asset_set.asset_set,
      campaign_asset_set.status,
      campaign.id,
      campaign.name,
      asset_set.id,
      asset_set.name,
      asset_set.type
    FROM campaign_asset_set
    ${campaignFilter}
    ORDER BY campaign_asset_set.resource_name DESC
    LIMIT ${args.limit}`,
  });
}

const LinkCampaignAssetSetSchema = BaseSchema.extend({
  campaignId: z.string().describe("Campaign ID/resource name"),
  assetSetId: z.string().describe("Asset set ID/resource name"),
  status: z.enum(["ENABLED", "REMOVED"]).default("ENABLED"),
});

async function linkCampaignAssetSet(args: z.infer<typeof LinkCampaignAssetSetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      campaign_asset_set_operation: {
        create: {
          campaign: toCampaignResourceName(args.customerId, args.campaignId),
          asset_set: toAssetSetResourceName(args.customerId, args.assetSetId),
          status: args.status,
        },
      },
    },
  ]);
}

const UnlinkCampaignAssetSetSchema = BaseSchema.extend({
  resourceName: z.string().optional().describe("customers/{customerId}/campaignAssetSets/{campaignId}~{assetSetId}"),
  campaignId: z.string().optional().describe("Campaign ID/resource name"),
  assetSetId: z.string().optional().describe("Asset set ID/resource name"),
}).refine(args => Boolean(args.resourceName) || Boolean(args.campaignId && args.assetSetId), {
  message: "Provide resourceName or campaignId+assetSetId.",
});

async function unlinkCampaignAssetSet(args: z.infer<typeof UnlinkCampaignAssetSetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName =
    args.resourceName ||
    toCampaignAssetSetResourceName(args.customerId, args.campaignId!, args.assetSetId!);

  return runMutation(customer, [
    {
      campaign_asset_set_operation: {
        remove: resourceName,
      },
    },
  ]);
}

const ListAssetGroupSignalsSchema = BaseSchema.extend({
  assetGroupId: z.string().optional().describe("Optional asset-group ID/resource name filter"),
  limit: z.number().int().min(1).max(1000).default(200),
});

async function listAssetGroupSignals(args: z.infer<typeof ListAssetGroupSignalsSchema>) {
  const filter = args.assetGroupId
    ? `WHERE asset_group_signal.asset_group = '${toAssetGroupResourceName(args.customerId, args.assetGroupId)}'`
    : "";

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      asset_group_signal.resource_name,
      asset_group_signal.asset_group,
      asset_group_signal.approval_status,
      asset_group_signal.disapproval_reasons,
      asset_group_signal.audience,
      asset_group_signal.search_theme,
      asset_group.id,
      asset_group.name,
      campaign.id,
      campaign.name
    FROM asset_group_signal
    ${filter}
    ORDER BY asset_group_signal.resource_name DESC
    LIMIT ${args.limit}`,
  });
}

const CreateAssetGroupSignalSchema = BaseSchema.extend({
  assetGroupId: z.string().describe("Asset group ID/resource name"),
  audienceId: z.string().optional().describe("Audience ID/resource name"),
  searchThemeText: z.string().optional().describe("Search theme text"),
}).refine(args => Boolean(args.audienceId) !== Boolean(args.searchThemeText), {
  message: "Provide exactly one of audienceId or searchThemeText.",
});

async function createAssetGroupSignal(args: z.infer<typeof CreateAssetGroupSignalSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const create: Record<string, unknown> = {
    asset_group: toAssetGroupResourceName(args.customerId, args.assetGroupId),
  };

  if (args.audienceId) {
    create.audience = {
      audience: toAudienceResourceName(args.customerId, args.audienceId),
    };
  }

  if (args.searchThemeText) {
    create.search_theme = {
      text: args.searchThemeText,
    };
  }

  return runMutation(customer, [
    {
      asset_group_signal_operation: {
        create,
      },
    },
  ]);
}

const UpdateAssetGroupSignalSchema = BaseSchema.extend({
  resourceName: z.string().describe("Asset group signal resource name"),
  audienceId: z.string().optional().describe("Audience ID/resource name"),
  searchThemeText: z.string().optional().describe("Search theme text"),
}).refine(args => Boolean(args.audienceId) !== Boolean(args.searchThemeText), {
  message: "Provide exactly one of audienceId or searchThemeText.",
});

async function updateAssetGroupSignal(args: z.infer<typeof UpdateAssetGroupSignalSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const update: Record<string, unknown> = {
    resource_name: args.resourceName,
  };
  const paths: string[] = [];

  if (args.audienceId) {
    update.audience = {
      audience: toAudienceResourceName(args.customerId, args.audienceId),
    };
    paths.push("audience");
  }

  if (args.searchThemeText) {
    update.search_theme = {
      text: args.searchThemeText,
    };
    paths.push("search_theme");
  }

  return runMutation(customer, [
    {
      asset_group_signal_operation: {
        update,
        update_mask: { paths },
      },
    },
  ]);
}

const RemoveAssetGroupSignalSchema = BaseSchema.extend({
  resourceName: z.string().describe("Asset group signal resource name"),
});

async function removeAssetGroupSignal(args: z.infer<typeof RemoveAssetGroupSignalSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      asset_group_signal_operation: {
        remove: args.resourceName,
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

export function registerAssetSetsSignalsTools(server: McpServer) {
  server.registerTool(
    "list_asset_sets",
    { description: "List asset sets.", inputSchema: ListAssetSetsSchema.shape },
    args => asTool(listAssetSets, args)
  );
  server.registerTool(
    "create_asset_set",
    { description: "Create an asset set.", inputSchema: CreateAssetSetSchema.shape },
    args => asTool(createAssetSet, args)
  );
  server.registerTool(
    "update_asset_set",
    { description: "Update an asset set.", inputSchema: UpdateAssetSetSchema.shape },
    args => asTool(updateAssetSet, args)
  );
  server.registerTool(
    "remove_asset_set",
    { description: "Remove an asset set.", inputSchema: RemoveAssetSetSchema.shape },
    args => asTool(removeAssetSet, args)
  );
  server.registerTool(
    "list_asset_set_assets",
    { description: "List asset-set asset links.", inputSchema: ListAssetSetAssetsSchema.shape },
    args => asTool(listAssetSetAssets, args)
  );
  server.registerTool(
    "link_asset_set_asset",
    { description: "Link an asset to an asset set.", inputSchema: LinkAssetSetAssetSchema.shape },
    args => asTool(linkAssetSetAsset, args)
  );
  server.registerTool(
    "unlink_asset_set_asset",
    { description: "Unlink an asset from an asset set.", inputSchema: UnlinkAssetSetAssetSchema.shape },
    args => asTool(unlinkAssetSetAsset, args)
  );
  server.registerTool(
    "list_campaign_asset_sets",
    { description: "List campaign-asset set links.", inputSchema: ListCampaignAssetSetsSchema.shape },
    args => asTool(listCampaignAssetSets, args)
  );
  server.registerTool(
    "link_campaign_asset_set",
    { description: "Link an asset set to a campaign.", inputSchema: LinkCampaignAssetSetSchema.shape },
    args => asTool(linkCampaignAssetSet, args)
  );
  server.registerTool(
    "unlink_campaign_asset_set",
    { description: "Unlink an asset set from a campaign.", inputSchema: UnlinkCampaignAssetSetSchema.shape },
    args => asTool(unlinkCampaignAssetSet, args)
  );
  server.registerTool(
    "list_asset_group_signals",
    { description: "List asset-group audience/search-theme signals.", inputSchema: ListAssetGroupSignalsSchema.shape },
    args => asTool(listAssetGroupSignals, args)
  );
  server.registerTool(
    "create_asset_group_signal",
    { description: "Create an asset-group signal.", inputSchema: CreateAssetGroupSignalSchema.shape },
    args => asTool(createAssetGroupSignal, args)
  );
  server.registerTool(
    "update_asset_group_signal",
    { description: "Update an asset-group signal.", inputSchema: UpdateAssetGroupSignalSchema.shape },
    args => asTool(updateAssetGroupSignal, args)
  );
  server.registerTool(
    "remove_asset_group_signal",
    { description: "Remove an asset-group signal.", inputSchema: RemoveAssetGroupSignalSchema.shape },
    args => asTool(removeAssetGroupSignal, args)
  );
}
