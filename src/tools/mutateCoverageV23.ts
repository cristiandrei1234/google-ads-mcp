import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";

const BaseSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

const ListResourceSchema = BaseSchema.extend({
  limit: z.number().int().min(1).max(1000).default(100),
  where: z.string().optional().describe("Optional GAQL filter expression without WHERE."),
  orderBy: z.string().optional().describe("Optional GAQL ORDER BY expression without ORDER BY."),
});

const GetResourceSchema = BaseSchema.extend({
  resourceName: z.string().describe("Full Google Ads resource name."),
});

const CreateResourceSchema = BaseSchema.extend({
  payload: z
    .record(z.string(), z.unknown())
    .refine(payload => Object.keys(payload).length > 0, {
      message: "payload must contain at least one field.",
    }),
});

const UpdateResourceSchema = BaseSchema.extend({
  resourceName: z.string().describe("Full Google Ads resource name."),
  payload: z
    .record(z.string(), z.unknown())
    .refine(payload => Object.keys(payload).length > 0, {
      message: "payload must contain at least one field.",
    }),
  updateMaskPaths: z
    .array(z.string())
    .optional()
    .describe("Optional field mask paths. Defaults to payload keys."),
});

const RemoveResourceSchema = BaseSchema.extend({
  resourceName: z.string().describe("Full Google Ads resource name to remove."),
});

type MutateVerb = "create" | "update" | "remove";

type FamilyConfig = {
  entity: string;
  plural: string;
  supports: readonly MutateVerb[];
  skipListTool?: boolean;
  skipGetTool?: boolean;
  skipMutateTools?: readonly MutateVerb[];
};

const COVERAGE_FAMILIES: readonly FamilyConfig[] = [
  { entity: "ad_group_ad_label", plural: "ad_group_ad_labels", supports: ["create", "remove"] },
  { entity: "ad_group_bid_modifier", plural: "ad_group_bid_modifiers", supports: ["create", "update", "remove"] },
  { entity: "ad_group_criterion_customizer", plural: "ad_group_criterion_customizers", supports: ["create", "remove"] },
  { entity: "ad_group_criterion_label", plural: "ad_group_criterion_labels", supports: ["create", "remove"] },
  { entity: "ad_group_customizer", plural: "ad_group_customizers", supports: ["create", "remove"] },
  { entity: "ad_group_label", plural: "ad_group_labels", supports: ["create", "remove"] },
  { entity: "ad", plural: "ads", supports: ["update"], skipListTool: true, skipGetTool: true },
  { entity: "ad_parameter", plural: "ad_parameters", supports: ["create", "update", "remove"] },
  {
    entity: "asset_group_listing_group_filter",
    plural: "asset_group_listing_group_filters",
    supports: ["create", "update", "remove"],
  },
  { entity: "audience", plural: "audiences", supports: ["create", "update"] },
  { entity: "campaign_bid_modifier", plural: "campaign_bid_modifiers", supports: ["create", "update", "remove"] },
  { entity: "campaign_customizer", plural: "campaign_customizers", supports: ["create", "remove"] },
  { entity: "campaign_group", plural: "campaign_groups", supports: ["create", "update", "remove"] },
  { entity: "conversion_custom_variable", plural: "conversion_custom_variables", supports: ["create", "update"] },
  { entity: "conversion_goal_campaign_config", plural: "conversion_goal_campaign_configs", supports: ["update"] },
  { entity: "conversion_value_rule", plural: "conversion_value_rules", supports: ["create", "update", "remove"] },
  { entity: "conversion_value_rule_set", plural: "conversion_value_rule_sets", supports: ["create", "update", "remove"] },
  { entity: "custom_conversion_goal", plural: "custom_conversion_goals", supports: ["create", "update", "remove"] },
  { entity: "customer_customizer", plural: "customer_customizers", supports: ["create", "remove"] },
  { entity: "customer_label", plural: "customer_labels", supports: ["create", "remove"] },
  { entity: "customer", plural: "customers", supports: ["update"] },
  { entity: "customizer_attribute", plural: "customizer_attributes", supports: ["create", "remove"] },
  { entity: "experiment_arm", plural: "experiment_arms", supports: ["create", "update", "remove"] },
  {
    entity: "keyword_plan_ad_group_keyword",
    plural: "keyword_plan_ad_group_keywords",
    supports: ["create", "update", "remove"],
  },
  {
    entity: "keyword_plan_ad_group",
    plural: "keyword_plan_ad_groups",
    supports: ["create", "update", "remove"],
    skipMutateTools: ["create"],
  },
  {
    entity: "keyword_plan_campaign_keyword",
    plural: "keyword_plan_campaign_keywords",
    supports: ["create", "update", "remove"],
  },
  {
    entity: "keyword_plan_campaign",
    plural: "keyword_plan_campaigns",
    supports: ["create", "update", "remove"],
    skipMutateTools: ["create"],
  },
  {
    entity: "keyword_plan",
    plural: "keyword_plans",
    supports: ["create", "update", "remove"],
    skipMutateTools: ["create", "update", "remove"],
  },
  { entity: "recommendation_subscription", plural: "recommendation_subscriptions", supports: ["create", "update"] },
  { entity: "remarketing_action", plural: "remarketing_actions", supports: ["create", "update"] },
  { entity: "smart_campaign_setting", plural: "smart_campaign_settings", supports: ["update"] },
];

function buildExpectedToolNames(config: FamilyConfig): string[] {
  const names: string[] = [];
  if (!config.skipListTool) {
    names.push(`list_${config.plural}`);
  }
  if (!config.skipGetTool) {
    names.push(`get_${config.entity}`);
  }
  if (isVerbRegistered(config, "create")) {
    names.push(`create_${config.entity}`);
  }
  if (isVerbRegistered(config, "update")) {
    names.push(`update_${config.entity}`);
  }
  if (isVerbRegistered(config, "remove")) {
    names.push(`remove_${config.entity}`);
  }
  return names;
}

export const MUTATE_COVERAGE_V23_EXPECTED_TOOL_NAMES: string[] = COVERAGE_FAMILIES.flatMap(
  buildExpectedToolNames
);

function escapeGaqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isVerbRegistered(config: FamilyConfig, verb: MutateVerb): boolean {
  if (!config.supports.includes(verb)) {
    return false;
  }
  if (!config.skipMutateTools) {
    return true;
  }
  return !config.skipMutateTools.includes(verb);
}

async function listFamilyResources(resource: string, args: z.infer<typeof ListResourceSchema>) {
  const whereClause = args.where ? `WHERE ${args.where}` : "";
  const orderClause = args.orderBy ? `ORDER BY ${args.orderBy}` : `ORDER BY ${resource}.resource_name`;

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      ${resource}.resource_name
    FROM ${resource}
    ${whereClause}
    ${orderClause}
    LIMIT ${args.limit}`,
  });
}

async function getFamilyResource(resource: string, args: z.infer<typeof GetResourceSchema>) {
  const escapedResourceName = escapeGaqlString(args.resourceName);

  const rows = await runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      ${resource}.resource_name
    FROM ${resource}
    WHERE ${resource}.resource_name = '${escapedResourceName}'
    LIMIT 1`,
  });

  return {
    found: rows.length > 0,
    row: rows[0] ?? null,
  };
}

async function createFamilyResource(operation: string, args: z.infer<typeof CreateResourceSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      [`${operation}_operation`]: {
        create: args.payload,
      },
    },
  ]);
}

async function updateFamilyResource(operation: string, args: z.infer<typeof UpdateResourceSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const updatePayload: Record<string, unknown> = {
    resource_name: args.resourceName,
    ...args.payload,
  };

  const inferredPaths = Object.keys(args.payload);
  const paths =
    args.updateMaskPaths && args.updateMaskPaths.length > 0
      ? args.updateMaskPaths
      : inferredPaths;

  if (paths.length === 0) {
    throw new Error("No update paths were resolved. Provide payload fields or updateMaskPaths.");
  }

  return runMutation(customer, [
    {
      [`${operation}_operation`]: {
        update: updatePayload,
        update_mask: { paths },
      },
    },
  ]);
}

async function removeFamilyResource(operation: string, args: z.infer<typeof RemoveResourceSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      [`${operation}_operation`]: {
        remove: args.resourceName,
      },
    },
  ]);
}

async function asTool(handler: () => Promise<unknown>): Promise<{
  content: [{ type: "text"; text: string }];
  isError?: true;
}> {
  try {
    const result = await handler();
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

function humanize(entity: string): string {
  return entity.replace(/_/g, " ");
}

export function registerMutateCoverageV23Tools(server: McpServer) {
  for (const family of COVERAGE_FAMILIES) {
    const entityLabel = humanize(family.entity);

    if (!family.skipListTool) {
      server.registerTool(
        `list_${family.plural}`,
        {
          description: `List ${entityLabel} resources.`,
          inputSchema: ListResourceSchema.shape,
        },
        args => asTool(() => listFamilyResources(family.entity, args as z.infer<typeof ListResourceSchema>))
      );
    }

    if (!family.skipGetTool) {
      server.registerTool(
        `get_${family.entity}`,
        {
          description: `Get one ${entityLabel} resource by resource name.`,
          inputSchema: GetResourceSchema.shape,
        },
        args => asTool(() => getFamilyResource(family.entity, args as z.infer<typeof GetResourceSchema>))
      );
    }

    if (isVerbRegistered(family, "create")) {
      server.registerTool(
        `create_${family.entity}`,
        {
          description: `Create one ${entityLabel} resource using raw payload fields.`,
          inputSchema: CreateResourceSchema.shape,
        },
        args =>
          asTool(() =>
            createFamilyResource(family.entity, args as z.infer<typeof CreateResourceSchema>)
          )
      );
    }

    if (isVerbRegistered(family, "update")) {
      server.registerTool(
        `update_${family.entity}`,
        {
          description: `Update one ${entityLabel} resource using raw payload fields.`,
          inputSchema: UpdateResourceSchema.shape,
        },
        args =>
          asTool(() =>
            updateFamilyResource(family.entity, args as z.infer<typeof UpdateResourceSchema>)
          )
      );
    }

    if (isVerbRegistered(family, "remove")) {
      server.registerTool(
        `remove_${family.entity}`,
        {
          description: `Remove one ${entityLabel} resource by resource name.`,
          inputSchema: RemoveResourceSchema.shape,
        },
        args =>
          asTool(() =>
            removeFamilyResource(family.entity, args as z.infer<typeof RemoveResourceSchema>)
          )
      );
    }
  }
}
