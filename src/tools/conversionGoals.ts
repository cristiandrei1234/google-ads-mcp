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

function toCustomerConversionGoalResourceName(
  customerId: string,
  category: string,
  origin: string
): string {
  return `customers/${normalizeCustomerId(customerId)}/customerConversionGoals/${category}~${origin}`;
}

function toCampaignConversionGoalResourceName(
  customerId: string,
  campaignIdOrResourceName: string,
  category: string,
  origin: string
): string {
  const campaignId = normalizeNumericId(campaignIdOrResourceName, "campaigns");
  return `customers/${normalizeCustomerId(customerId)}/campaignConversionGoals/${campaignId}~${category}~${origin}`;
}

const ListCustomerConversionGoalsSchema = BaseSchema.extend({
  includeOnlyBiddable: z.boolean().default(false),
  limit: z.number().int().min(1).max(1000).default(200),
});

async function listCustomerConversionGoals(args: z.infer<typeof ListCustomerConversionGoalsSchema>) {
  const where = args.includeOnlyBiddable ? "WHERE customer_conversion_goal.biddable = true" : "";

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      customer_conversion_goal.resource_name,
      customer_conversion_goal.category,
      customer_conversion_goal.origin,
      customer_conversion_goal.biddable
    FROM customer_conversion_goal
    ${where}
    LIMIT ${args.limit}`,
  });
}

const SetCustomerConversionGoalSchema = BaseSchema.extend({
  resourceName: z.string().optional().describe("customers/{customerId}/customerConversionGoals/{category}~{origin}"),
  category: z.string().optional().describe("Conversion action category enum value"),
  origin: z.string().optional().describe("Conversion origin enum value"),
  biddable: z.boolean(),
}).refine(args => Boolean(args.resourceName) || Boolean(args.category && args.origin), {
  message: "Provide resourceName or both category and origin.",
});

async function setCustomerConversionGoal(args: z.infer<typeof SetCustomerConversionGoalSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const resourceName =
    args.resourceName ||
    toCustomerConversionGoalResourceName(args.customerId, args.category!, args.origin!);

  return runMutation(customer, [
    {
      customer_conversion_goal_operation: {
        update: {
          resource_name: resourceName,
          biddable: args.biddable,
        },
        update_mask: {
          paths: ["biddable"],
        },
      },
    },
  ]);
}

const ListCampaignConversionGoalsSchema = BaseSchema.extend({
  campaignId: z.string().optional().describe("Optional campaign ID/resource name filter"),
  includeOnlyBiddable: z.boolean().default(false),
  limit: z.number().int().min(1).max(1000).default(300),
});

async function listCampaignConversionGoals(args: z.infer<typeof ListCampaignConversionGoalsSchema>) {
  const filters: string[] = [];

  if (args.campaignId) {
    const campaignId = normalizeNumericId(args.campaignId, "campaigns");
    filters.push(`campaign.id = ${campaignId}`);
  }

  if (args.includeOnlyBiddable) {
    filters.push("campaign_conversion_goal.biddable = true");
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  return runQuery({
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
    ${where}
    LIMIT ${args.limit}`,
  });
}

const SetCampaignConversionGoalSchema = BaseSchema.extend({
  resourceName: z.string().optional().describe(
    "customers/{customerId}/campaignConversionGoals/{campaignId}~{category}~{origin}"
  ),
  campaignId: z.string().optional().describe("Campaign ID/resource name"),
  category: z.string().optional().describe("Conversion action category enum value"),
  origin: z.string().optional().describe("Conversion origin enum value"),
  biddable: z.boolean(),
}).refine(args => Boolean(args.resourceName) || Boolean(args.campaignId && args.category && args.origin), {
  message: "Provide resourceName or campaignId+category+origin.",
});

async function setCampaignConversionGoal(args: z.infer<typeof SetCampaignConversionGoalSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const resourceName =
    args.resourceName ||
    toCampaignConversionGoalResourceName(args.customerId, args.campaignId!, args.category!, args.origin!);

  return runMutation(customer, [
    {
      campaign_conversion_goal_operation: {
        update: {
          resource_name: resourceName,
          biddable: args.biddable,
        },
        update_mask: {
          paths: ["biddable"],
        },
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

export function registerConversionGoalTools(server: McpServer) {
  server.registerTool(
    "list_customer_conversion_goals",
    {
      description: "List customer-level conversion goals.",
      inputSchema: ListCustomerConversionGoalsSchema.shape,
    },
    args => asTool(listCustomerConversionGoals, args)
  );
  server.registerTool(
    "set_customer_conversion_goal",
    {
      description: "Set customer-level conversion goal biddable flag.",
      inputSchema: SetCustomerConversionGoalSchema.shape,
    },
    args => asTool(setCustomerConversionGoal, args)
  );
  server.registerTool(
    "list_campaign_conversion_goals",
    {
      description: "List campaign-level conversion goals.",
      inputSchema: ListCampaignConversionGoalsSchema.shape,
    },
    args => asTool(listCampaignConversionGoals, args)
  );
  server.registerTool(
    "set_campaign_conversion_goal",
    {
      description: "Set campaign-level conversion goal biddable flag.",
      inputSchema: SetCampaignConversionGoalSchema.shape,
    },
    args => asTool(setCampaignConversionGoal, args)
  );
}
