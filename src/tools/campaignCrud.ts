import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
const CreateCampaignBudgetSchema = BaseSchema.extend({
    name: z.string().describe("Campaign budget name"),
    amountMicros: z.number().int().positive().describe("Budget amount in micros"),
    deliveryMethod: z.enum(["STANDARD", "ACCELERATED"]).default("STANDARD"),
    explicitlyShared: z.boolean().default(false),
});
async function createCampaignBudget(args: z.infer<typeof CreateCampaignBudgetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            campaign_budget_operation: {
                create: {
                    name: args.name,
                    amount_micros: args.amountMicros,
                    delivery_method: args.deliveryMethod,
                    explicitly_shared: args.explicitlyShared,
                },
            },
        },
    ]);
}
const UpdateCampaignBudgetSchema = BaseSchema.extend({
    budgetId: z.string(),
    name: z.string().optional(),
    amountMicros: z.number().int().positive().optional(),
    deliveryMethod: z.enum(["STANDARD", "ACCELERATED"]).optional(),
});
async function updateCampaignBudget(args: z.infer<typeof UpdateCampaignBudgetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const update: any = {
        resource_name: `customers/${args.customerId}/campaignBudgets/${args.budgetId}`,
    };
    const paths: string[] = [];
    if (args.name) {
        update.name = args.name;
        paths.push("name");
    }
    if (args.amountMicros != null) {
        update.amount_micros = args.amountMicros;
        paths.push("amount_micros");
    }
    if (args.deliveryMethod) {
        update.delivery_method = args.deliveryMethod;
        paths.push("delivery_method");
    }
    if (paths.length === 0) {
        throw new Error("At least one field is required for update_campaign_budget.");
    }
    return runMutation(customer, [
        {
            campaign_budget_operation: {
                update,
                update_mask: { paths },
            },
        },
    ]);
}
const ListCampaignsSchema = BaseSchema.extend({
    limit: z.number().default(100),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
});
async function listCampaigns(args: z.infer<typeof ListCampaignsSchema>) {
    const filters: string[] = [];
    if (args.status) {
        filters.push(`campaign.status = ${args.status}`);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign.campaign_budget,
      campaign.start_date,
      campaign.end_date
    FROM campaign
    ${where}
    ORDER BY campaign.id DESC
    LIMIT ${args.limit}`,
    });
}
const CreateCampaignSchema = BaseSchema.extend({
    name: z.string(),
    budgetId: z.string(),
    status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
    advertisingChannelType: z
        .enum(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX", "DEMAND_GEN", "SMART"])
        .default("SEARCH"),
    biddingStrategy: z.enum(["MANUAL_CPC", "MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE"]).default("MANUAL_CPC"),
    containsEuPoliticalAdvertising: z
        .enum(["CONTAINS_EU_POLITICAL_ADVERTISING", "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"])
        .default("DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING"),
    targetGoogleSearch: z.boolean().default(true),
    targetSearchNetwork: z.boolean().default(true),
    targetContentNetwork: z.boolean().default(false),
    targetPartnerSearchNetwork: z.boolean().default(false),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
});
async function createCampaign(args: z.infer<typeof CreateCampaignSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const create: any = {
        name: args.name,
        status: args.status,
        advertising_channel_type: args.advertisingChannelType,
        campaign_budget: `customers/${args.customerId}/campaignBudgets/${args.budgetId}`,
        contains_eu_political_advertising: args.containsEuPoliticalAdvertising,
        network_settings: {
            target_google_search: args.targetGoogleSearch,
            target_search_network: args.targetSearchNetwork,
            target_content_network: args.targetContentNetwork,
            target_partner_search_network: args.targetPartnerSearchNetwork,
        },
    };
    if (args.startDate)
        create.start_date = args.startDate;
    if (args.endDate)
        create.end_date = args.endDate;
    if (args.biddingStrategy === "MAXIMIZE_CONVERSIONS") {
        create.maximize_conversions = {};
    }
    else if (args.biddingStrategy === "MAXIMIZE_CONVERSION_VALUE") {
        create.maximize_conversion_value = {};
    }
    else {
        create.manual_cpc = {};
    }
    return runMutation(customer, [{ campaign_operation: { create } }]);
}
const UpdateCampaignSettingsSchema = BaseSchema.extend({
    campaignId: z.string(),
    name: z.string().optional(),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
});
async function updateCampaignSettings(args: z.infer<typeof UpdateCampaignSettingsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const update: any = {
        resource_name: `customers/${args.customerId}/campaigns/${args.campaignId}`,
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
    if (args.startDate) {
        update.start_date = args.startDate;
        paths.push("start_date");
    }
    if (args.endDate) {
        update.end_date = args.endDate;
        paths.push("end_date");
    }
    if (paths.length === 0) {
        throw new Error("At least one field is required for update_campaign_settings.");
    }
    return runMutation(customer, [
        {
            campaign_operation: {
                update,
                update_mask: { paths },
            },
        },
    ]);
}
const AttachCampaignBudgetSchema = BaseSchema.extend({
    campaignId: z.string(),
    budgetId: z.string(),
});
async function attachCampaignBudget(args: z.infer<typeof AttachCampaignBudgetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            campaign_operation: {
                update: {
                    resource_name: `customers/${args.customerId}/campaigns/${args.campaignId}`,
                    campaign_budget: `customers/${args.customerId}/campaignBudgets/${args.budgetId}`,
                },
                update_mask: {
                    paths: ["campaign_budget"],
                },
            },
        },
    ]);
}
const DetachCampaignBudgetSchema = BaseSchema.extend({
    campaignId: z.string(),
    fallbackBudgetId: z.string(),
});
async function detachCampaignBudget(args: z.infer<typeof DetachCampaignBudgetSchema>) {
    return attachCampaignBudget({
        customerId: args.customerId,
        userId: args.userId,
        campaignId: args.campaignId,
        budgetId: args.fallbackBudgetId,
    });
}
const SetCampaignNetworkSettingsSchema = BaseSchema.extend({
    campaignId: z.string(),
    targetGoogleSearch: z.boolean(),
    targetSearchNetwork: z.boolean(),
    targetContentNetwork: z.boolean(),
    targetPartnerSearchNetwork: z.boolean(),
});
async function setCampaignNetworkSettings(args: z.infer<typeof SetCampaignNetworkSettingsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            campaign_operation: {
                update: {
                    resource_name: `customers/${args.customerId}/campaigns/${args.campaignId}`,
                    network_settings: {
                        target_google_search: args.targetGoogleSearch,
                        target_search_network: args.targetSearchNetwork,
                        target_content_network: args.targetContentNetwork,
                        target_partner_search_network: args.targetPartnerSearchNetwork,
                    },
                },
                update_mask: {
                    paths: [
                        "network_settings.target_google_search",
                        "network_settings.target_search_network",
                        "network_settings.target_content_network",
                        "network_settings.target_partner_search_network",
                    ],
                },
            },
        },
    ]);
}
async function asTool(fn: (args: any) => Promise<any>, args: any): Promise<{
    content: [
        {
            type: "text";
            text: string;
        }
    ];
    isError?: true;
}> {
    try {
        const result = await fn(args);
        return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
export function registerCampaignCrudTools(server: McpServer) {
    server.registerTool("list_campaigns", { description: "List campaigns with optional status filter.", inputSchema: ListCampaignsSchema.shape }, args => asTool(listCampaigns, args));
    server.registerTool("create_campaign_budget", { description: "Create a campaign budget.", inputSchema: CreateCampaignBudgetSchema.shape }, args => asTool(createCampaignBudget, args));
    server.registerTool("update_campaign_budget", { description: "Update a campaign budget.", inputSchema: UpdateCampaignBudgetSchema.shape }, args => asTool(updateCampaignBudget, args));
    server.registerTool("create_campaign", { description: "Create a new campaign.", inputSchema: CreateCampaignSchema.shape }, args => asTool(createCampaign, args));
    server.registerTool("update_campaign_settings", { description: "Update campaign settings.", inputSchema: UpdateCampaignSettingsSchema.shape }, args => asTool(updateCampaignSettings, args));
    server.registerTool("attach_campaign_budget", { description: "Attach a campaign to a budget.", inputSchema: AttachCampaignBudgetSchema.shape }, args => asTool(attachCampaignBudget, args));
    server.registerTool("detach_campaign_budget", { description: "Swap campaign to another budget (Ads requires one budget).", inputSchema: DetachCampaignBudgetSchema.shape }, args => asTool(detachCampaignBudget, args));
    server.registerTool("set_campaign_network_settings", { description: "Update campaign network targeting settings.", inputSchema: SetCampaignNetworkSettingsSchema.shape }, args => asTool(setCampaignNetworkSettings, args));
}
