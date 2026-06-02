import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { asTool } from "./_runtime.js";
import { BaseSchema } from "./_schemas.js";
import { normalizeCustomerId, extractResourceId, normalizeNumericId, toResourceName } from "../services/google-ads/resourceNames.js";





function toCampaignResourceName(customerId: string, campaignIdOrResourceName: string): string {
  return toResourceName(customerId, campaignIdOrResourceName, "campaigns");
}

function toAdGroupResourceName(customerId: string, adGroupIdOrResourceName: string): string {
  return toResourceName(customerId, adGroupIdOrResourceName, "adGroups");
}

function toCustomAudienceResourceName(customerId: string, customAudienceIdOrResourceName: string): string {
  return toResourceName(customerId, customAudienceIdOrResourceName, "customAudiences");
}

function toCombinedAudienceResourceName(customerId: string, combinedAudienceIdOrResourceName: string): string {
  return toResourceName(customerId, combinedAudienceIdOrResourceName, "combinedAudiences");
}

function toCampaignCriterionResourceName(
  customerId: string,
  campaignIdOrResourceName: string,
  criterionId: string
): string {
  const campaignId = normalizeNumericId(campaignIdOrResourceName, "campaigns");
  const normalizedCustomerId = normalizeCustomerId(customerId);
  return `customers/${normalizedCustomerId}/campaignCriteria/${campaignId}~${criterionId}`;
}

function toAdGroupCriterionResourceName(
  customerId: string,
  adGroupIdOrResourceName: string,
  criterionId: string
): string {
  const adGroupId = normalizeNumericId(adGroupIdOrResourceName, "adGroups");
  const normalizedCustomerId = normalizeCustomerId(customerId);
  return `customers/${normalizedCustomerId}/adGroupCriteria/${adGroupId}~${criterionId}`;
}

type CustomAudienceOperation = {
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
  remove?: string;
  update_mask?: { paths: string[] };
};

async function mutateCustomAudiences(
  customer: any,
  customerId: string,
  operations: CustomAudienceOperation[]
) {
  const service = (customer as any).loadService("CustomAudienceServiceClient");
  const [result] = await service.mutateCustomAudiences(
    {
      customer_id: normalizeCustomerId(customerId),
      operations,
      validate_only: ["1", "true", "yes"].includes(
        (process.env.GOOGLE_ADS_VALIDATE_ONLY || "").toLowerCase()
      ),
    },
    {
      otherArgs: {
        headers: (customer as any).callHeaders,
      },
    }
  );

  return result;
}

const ListCustomAudiencesSchema = BaseSchema.extend({
  status: z.enum(["ENABLED", "REMOVED"]).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

async function listCustomAudiences(args: z.infer<typeof ListCustomAudiencesSchema>) {
  const where = args.status ? `WHERE custom_audience.status = ${args.status}` : "";

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      custom_audience.resource_name,
      custom_audience.id,
      custom_audience.name,
      custom_audience.status,
      custom_audience.type,
      custom_audience.description
    FROM custom_audience
    ${where}
    ORDER BY custom_audience.id DESC
    LIMIT ${args.limit}`,
  });
}

const CustomAudienceMemberSchema = z.object({
  memberType: z.enum(["KEYWORD", "URL", "PLACE_CATEGORY", "APP"]),
  keyword: z.string().optional(),
  url: z.string().optional(),
  placeCategory: z.number().int().positive().optional(),
  app: z.string().optional(),
});

function toCustomAudienceMember(member: z.infer<typeof CustomAudienceMemberSchema>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    member_type: member.memberType,
  };

  if (member.memberType === "KEYWORD") {
    if (!member.keyword) {
      throw new Error("keyword is required when memberType is KEYWORD.");
    }
    result.keyword = member.keyword;
  }

  if (member.memberType === "URL") {
    if (!member.url) {
      throw new Error("url is required when memberType is URL.");
    }
    result.url = member.url;
  }

  if (member.memberType === "PLACE_CATEGORY") {
    if (member.placeCategory == null) {
      throw new Error("placeCategory is required when memberType is PLACE_CATEGORY.");
    }
    result.place_category = member.placeCategory;
  }

  if (member.memberType === "APP") {
    if (!member.app) {
      throw new Error("app is required when memberType is APP.");
    }
    result.app = member.app;
  }

  return result;
}

const CreateCustomAudienceSchema = BaseSchema.extend({
  name: z.string().min(1),
  type: z.enum(["AUTO", "INTEREST", "PURCHASE_INTENT", "SEARCH"]).default("SEARCH"),
  description: z.string().optional(),
  status: z.enum(["ENABLED", "REMOVED"]).default("ENABLED"),
  members: z.array(CustomAudienceMemberSchema).min(1),
});

async function createCustomAudience(args: z.infer<typeof CreateCustomAudienceSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const create: Record<string, unknown> = {
    name: args.name,
    type: args.type,
    status: args.status,
    members: args.members.map(toCustomAudienceMember),
  };

  if (args.description) {
    create.description = args.description;
  }

  return mutateCustomAudiences(customer, args.customerId, [{ create }]);
}

const UpdateCustomAudienceSchema = BaseSchema.extend({
  customAudienceId: z.string().describe("Custom audience ID/resource name"),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["ENABLED", "REMOVED"]).optional(),
  type: z.enum(["AUTO", "INTEREST", "PURCHASE_INTENT", "SEARCH"]).optional(),
  members: z.array(CustomAudienceMemberSchema).optional(),
});

async function updateCustomAudience(args: z.infer<typeof UpdateCustomAudienceSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const update: Record<string, unknown> = {
    resource_name: toCustomAudienceResourceName(args.customerId, args.customAudienceId),
  };
  const paths: string[] = [];

  if (args.name) {
    update.name = args.name;
    paths.push("name");
  }
  if (args.description !== undefined) {
    update.description = args.description;
    paths.push("description");
  }
  if (args.status) {
    update.status = args.status;
    paths.push("status");
  }
  if (args.type) {
    update.type = args.type;
    paths.push("type");
  }
  if (args.members) {
    update.members = args.members.map(toCustomAudienceMember);
    paths.push("members");
  }

  if (paths.length === 0) {
    throw new Error("At least one field is required for update_custom_audience.");
  }

  return mutateCustomAudiences(customer, args.customerId, [{ update, update_mask: { paths } }]);
}

const RemoveCustomAudienceSchema = BaseSchema.extend({
  customAudienceId: z.string().describe("Custom audience ID/resource name"),
});

async function removeCustomAudience(args: z.infer<typeof RemoveCustomAudienceSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return mutateCustomAudiences(customer, args.customerId, [
    {
      remove: toCustomAudienceResourceName(args.customerId, args.customAudienceId),
    },
  ]);
}

const ListCombinedAudiencesSchema = BaseSchema.extend({
  status: z.enum(["ENABLED", "REMOVED"]).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

async function listCombinedAudiences(args: z.infer<typeof ListCombinedAudiencesSchema>) {
  const where = args.status ? `WHERE combined_audience.status = ${args.status}` : "";

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      combined_audience.resource_name,
      combined_audience.id,
      combined_audience.name,
      combined_audience.status,
      combined_audience.description
    FROM combined_audience
    ${where}
    ORDER BY combined_audience.id DESC
    LIMIT ${args.limit}`,
  });
}

const AddCampaignCustomAudienceTargetingSchema = BaseSchema.extend({
  campaignId: z.string().describe("Campaign ID/resource name"),
  customAudienceId: z.string().describe("Custom audience ID/resource name"),
  negative: z.boolean().default(false),
});

async function addCampaignCustomAudienceTargeting(
  args: z.infer<typeof AddCampaignCustomAudienceTargetingSchema>
) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      campaign_criterion_operation: {
        create: {
          campaign: toCampaignResourceName(args.customerId, args.campaignId),
          negative: args.negative,
          custom_audience: {
            custom_audience: toCustomAudienceResourceName(args.customerId, args.customAudienceId),
          },
        },
      },
    },
  ]);
}

const AddCampaignCombinedAudienceTargetingSchema = BaseSchema.extend({
  campaignId: z.string().describe("Campaign ID/resource name"),
  combinedAudienceId: z.string().describe("Combined audience ID/resource name"),
  negative: z.boolean().default(false),
});

async function addCampaignCombinedAudienceTargeting(
  args: z.infer<typeof AddCampaignCombinedAudienceTargetingSchema>
) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      campaign_criterion_operation: {
        create: {
          campaign: toCampaignResourceName(args.customerId, args.campaignId),
          negative: args.negative,
          combined_audience: {
            combined_audience: toCombinedAudienceResourceName(args.customerId, args.combinedAudienceId),
          },
        },
      },
    },
  ]);
}

const AddAdGroupCustomAudienceTargetingSchema = BaseSchema.extend({
  adGroupId: z.string().describe("Ad group ID/resource name"),
  customAudienceId: z.string().describe("Custom audience ID/resource name"),
  negative: z.boolean().default(false),
});

async function addAdGroupCustomAudienceTargeting(args: z.infer<typeof AddAdGroupCustomAudienceTargetingSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      ad_group_criterion_operation: {
        create: {
          ad_group: toAdGroupResourceName(args.customerId, args.adGroupId),
          negative: args.negative,
          custom_audience: {
            custom_audience: toCustomAudienceResourceName(args.customerId, args.customAudienceId),
          },
        },
      },
    },
  ]);
}

const AddAdGroupCombinedAudienceTargetingSchema = BaseSchema.extend({
  adGroupId: z.string().describe("Ad group ID/resource name"),
  combinedAudienceId: z.string().describe("Combined audience ID/resource name"),
  negative: z.boolean().default(false),
});

async function addAdGroupCombinedAudienceTargeting(
  args: z.infer<typeof AddAdGroupCombinedAudienceTargetingSchema>
) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      ad_group_criterion_operation: {
        create: {
          ad_group: toAdGroupResourceName(args.customerId, args.adGroupId),
          negative: args.negative,
          combined_audience: {
            combined_audience: toCombinedAudienceResourceName(args.customerId, args.combinedAudienceId),
          },
        },
      },
    },
  ]);
}

const RemoveCampaignAudienceTargetingSchema = BaseSchema.extend({
  campaignId: z.string().describe("Campaign ID/resource name"),
  criterionId: z.string().describe("Campaign criterion ID"),
});

async function removeCampaignAudienceTargeting(args: z.infer<typeof RemoveCampaignAudienceTargetingSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      campaign_criterion_operation: {
        remove: toCampaignCriterionResourceName(args.customerId, args.campaignId, args.criterionId),
      },
    },
  ]);
}

const RemoveAdGroupAudienceTargetingSchema = BaseSchema.extend({
  adGroupId: z.string().describe("Ad group ID/resource name"),
  criterionId: z.string().describe("Ad-group criterion ID"),
});

async function removeAdGroupAudienceTargeting(args: z.infer<typeof RemoveAdGroupAudienceTargetingSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      ad_group_criterion_operation: {
        remove: toAdGroupCriterionResourceName(args.customerId, args.adGroupId, args.criterionId),
      },
    },
  ]);
}


export function registerAudiencesAdvancedTools(server: McpServer) {
  server.registerTool(
    "list_custom_audiences",
    { description: "List custom audiences.", inputSchema: ListCustomAudiencesSchema.shape },
    args => asTool(listCustomAudiences, args)
  );
  server.registerTool(
    "create_custom_audience",
    { description: "Create a custom audience.", inputSchema: CreateCustomAudienceSchema.shape },
    args => asTool(createCustomAudience, args)
  );
  server.registerTool(
    "update_custom_audience",
    { description: "Update a custom audience.", inputSchema: UpdateCustomAudienceSchema.shape },
    args => asTool(updateCustomAudience, args)
  );
  server.registerTool(
    "remove_custom_audience",
    { description: "Remove a custom audience.", inputSchema: RemoveCustomAudienceSchema.shape },
    args => asTool(removeCustomAudience, args)
  );
  server.registerTool(
    "list_combined_audiences",
    { description: "List combined audiences.", inputSchema: ListCombinedAudiencesSchema.shape },
    args => asTool(listCombinedAudiences, args)
  );
  server.registerTool(
    "add_campaign_custom_audience_targeting",
    {
      description: "Add custom-audience targeting to a campaign criterion.",
      inputSchema: AddCampaignCustomAudienceTargetingSchema.shape,
    },
    args => asTool(addCampaignCustomAudienceTargeting, args)
  );
  server.registerTool(
    "add_campaign_combined_audience_targeting",
    {
      description: "Add combined-audience targeting to a campaign criterion.",
      inputSchema: AddCampaignCombinedAudienceTargetingSchema.shape,
    },
    args => asTool(addCampaignCombinedAudienceTargeting, args)
  );
  server.registerTool(
    "add_ad_group_custom_audience_targeting",
    {
      description: "Add custom-audience targeting to an ad-group criterion.",
      inputSchema: AddAdGroupCustomAudienceTargetingSchema.shape,
    },
    args => asTool(addAdGroupCustomAudienceTargeting, args)
  );
  server.registerTool(
    "add_ad_group_combined_audience_targeting",
    {
      description: "Add combined-audience targeting to an ad-group criterion.",
      inputSchema: AddAdGroupCombinedAudienceTargetingSchema.shape,
    },
    args => asTool(addAdGroupCombinedAudienceTargeting, args)
  );
  server.registerTool(
    "remove_campaign_audience_targeting",
    {
      description: "Remove campaign audience criterion by criterion ID.",
      inputSchema: RemoveCampaignAudienceTargetingSchema.shape,
    },
    args => asTool(removeCampaignAudienceTargeting, args)
  );
  server.registerTool(
    "remove_ad_group_audience_targeting",
    {
      description: "Remove ad-group audience criterion by criterion ID.",
      inputSchema: RemoveAdGroupAudienceTargetingSchema.shape,
    },
    args => asTool(removeAdGroupAudienceTargeting, args)
  );
}
