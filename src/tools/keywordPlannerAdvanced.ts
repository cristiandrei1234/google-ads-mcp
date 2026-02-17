import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
const MatchTypeSchema = z.enum(["BROAD", "PHRASE", "EXACT"]);
const GenerateKeywordHistoricalMetricsSchema = BaseSchema.extend({
    keywords: z.array(z.string()).min(1),
    languageId: z.string().default("1000"),
    geoTargetConstantIds: z.array(z.string()).default([]),
    includeAdultKeywords: z.boolean().default(false),
    keywordPlanNetwork: z.enum(["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"]).default("GOOGLE_SEARCH_AND_PARTNERS"),
});
async function generateKeywordHistoricalMetrics(args: z.infer<typeof GenerateKeywordHistoricalMetricsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).keywordPlanIdeas.generateKeywordHistoricalMetrics({
        customer_id: args.customerId,
        keywords: args.keywords,
        language: `languageConstants/${args.languageId}`,
        include_adult_keywords: args.includeAdultKeywords,
        geo_target_constants: args.geoTargetConstantIds.map(id => `geoTargetConstants/${id}`),
        keyword_plan_network: args.keywordPlanNetwork,
    });
}
const GenerateKeywordForecastMetricsSchema = BaseSchema.extend({
    keywords: z.array(z.object({ text: z.string(), matchType: MatchTypeSchema, cpcBidMicros: z.number().int().positive().optional() })).min(1),
    languageId: z.string().default("1000"),
    geoTargetConstantIds: z.array(z.string()).default([]),
    currencyCode: z.string().default("USD"),
    startDate: z.string().describe("YYYY-MM-DD"),
    endDate: z.string().describe("YYYY-MM-DD"),
    maxCpcBidMicros: z.number().int().positive().default(1000000),
    dailyBudgetMicros: z.number().int().positive().default(10000000),
    keywordPlanNetwork: z.enum(["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"]).default("GOOGLE_SEARCH_AND_PARTNERS"),
});
async function generateKeywordForecastMetrics(args: z.infer<typeof GenerateKeywordForecastMetricsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).keywordPlanIdeas.generateKeywordForecastMetrics({
        customer_id: args.customerId,
        currency_code: args.currencyCode,
        forecast_period: {
            start_date: args.startDate,
            end_date: args.endDate,
        },
        campaign: {
            keyword_plan_network: args.keywordPlanNetwork,
            language_constants: [`languageConstants/${args.languageId}`],
            geo_modifiers: args.geoTargetConstantIds.map(id => ({
                geo_target_constant: `geoTargetConstants/${id}`,
                bid_modifier: 1,
            })),
            bidding_strategy: {
                manual_cpc_bidding_strategy: {
                    daily_budget_micros: args.dailyBudgetMicros,
                    max_cpc_bid_micros: args.maxCpcBidMicros,
                },
            },
            ad_groups: [
                {
                    max_cpc_bid_micros: args.maxCpcBidMicros,
                    biddable_keywords: args.keywords.map(keyword => ({
                        keyword: {
                            text: keyword.text,
                            match_type: keyword.matchType,
                        },
                        max_cpc_bid_micros: keyword.cpcBidMicros ?? args.maxCpcBidMicros,
                    })),
                },
            ],
        },
    });
}
const CreateKeywordPlanSchema = BaseSchema.extend({
    name: z.string(),
    forecastDateInterval: z
        .enum(["NEXT_QUARTER", "NEXT_MONTH", "NEXT_YEAR"])
        .default("NEXT_QUARTER"),
});
async function createKeywordPlan(args: z.infer<typeof CreateKeywordPlanSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).keywordPlans.create([
        {
            name: args.name,
            forecast_period: {
                date_interval: args.forecastDateInterval,
            },
        },
    ]);
}
const UpdateKeywordPlanSchema = BaseSchema.extend({
    keywordPlanId: z.string(),
    name: z.string().optional(),
    forecastDateInterval: z.enum(["NEXT_QUARTER", "NEXT_MONTH", "NEXT_YEAR"]).optional(),
});
async function updateKeywordPlan(args: z.infer<typeof UpdateKeywordPlanSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const update: any = {
        resource_name: `customers/${args.customerId}/keywordPlans/${args.keywordPlanId}`,
    };
    if (args.name) {
        update.name = args.name;
    }
    if (args.forecastDateInterval) {
        update.forecast_period = { date_interval: args.forecastDateInterval };
    }
    return (customer as any).keywordPlans.update([update]);
}
const RemoveKeywordPlanSchema = BaseSchema.extend({
    keywordPlanId: z.string(),
});
async function removeKeywordPlan(args: z.infer<typeof RemoveKeywordPlanSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).keywordPlans.remove([
        `customers/${args.customerId}/keywordPlans/${args.keywordPlanId}`,
    ]);
}
const CreateKeywordPlanCampaignSchema = BaseSchema.extend({
    keywordPlanId: z.string(),
    name: z.string().optional(),
    cpcBidMicros: z.number().int().positive(),
    geoTargetConstantIds: z.array(z.string()).default([]),
    languageIds: z.array(z.string()).default([]),
    keywordPlanNetwork: z.enum(["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"]).default("GOOGLE_SEARCH_AND_PARTNERS"),
});
async function createKeywordPlanCampaign(args: z.infer<typeof CreateKeywordPlanCampaignSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).keywordPlanCampaigns.create([
        {
            keyword_plan: `customers/${args.customerId}/keywordPlans/${args.keywordPlanId}`,
            ...(args.name ? { name: args.name } : {}),
            cpc_bid_micros: args.cpcBidMicros,
            keyword_plan_network: args.keywordPlanNetwork,
            language_constants: args.languageIds.map(id => `languageConstants/${id}`),
            geo_targets: args.geoTargetConstantIds.map(id => ({
                geo_target_constant: `geoTargetConstants/${id}`,
            })),
        },
    ]);
}
const CreateKeywordPlanAdGroupSchema = BaseSchema.extend({
    keywordPlanCampaignId: z.string(),
    name: z.string(),
    cpcBidMicros: z.number().int().positive(),
});
async function createKeywordPlanAdGroup(args: z.infer<typeof CreateKeywordPlanAdGroupSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).keywordPlanAdGroups.create([
        {
            keyword_plan_campaign: `customers/${args.customerId}/keywordPlanCampaigns/${args.keywordPlanCampaignId}`,
            name: args.name,
            cpc_bid_micros: args.cpcBidMicros,
        },
    ]);
}
const AddKeywordPlanKeywordsSchema = BaseSchema.extend({
    keywordPlanAdGroupId: z.string(),
    keywords: z.array(z.object({ text: z.string(), matchType: MatchTypeSchema, cpcBidMicros: z.number().int().positive().optional(), negative: z.boolean().default(false) })).min(1),
});
async function addKeywordPlanKeywords(args: z.infer<typeof AddKeywordPlanKeywordsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).keywordPlanAdGroupKeywords.create(args.keywords.map(keyword => ({
        keyword_plan_ad_group: `customers/${args.customerId}/keywordPlanAdGroups/${args.keywordPlanAdGroupId}`,
        text: keyword.text,
        match_type: keyword.matchType,
        ...(keyword.cpcBidMicros ? { cpc_bid_micros: keyword.cpcBidMicros } : {}),
        negative: keyword.negative,
    })));
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
}
export function registerKeywordPlannerAdvancedTools(server: McpServer) {
    server.registerTool("generate_keyword_historical_metrics", { description: "Generate Keyword Planner historical metrics.", inputSchema: GenerateKeywordHistoricalMetricsSchema.shape }, args => asTool(generateKeywordHistoricalMetrics, args));
    server.registerTool("generate_keyword_forecast_metrics", { description: "Generate Keyword Planner forecast metrics.", inputSchema: GenerateKeywordForecastMetricsSchema.shape }, args => asTool(generateKeywordForecastMetrics, args));
    server.registerTool("create_keyword_plan", { description: "Create a keyword plan.", inputSchema: CreateKeywordPlanSchema.shape }, args => asTool(createKeywordPlan, args));
    server.registerTool("update_keyword_plan", { description: "Update a keyword plan.", inputSchema: UpdateKeywordPlanSchema.shape }, args => asTool(updateKeywordPlan, args));
    server.registerTool("remove_keyword_plan", { description: "Remove a keyword plan.", inputSchema: RemoveKeywordPlanSchema.shape }, args => asTool(removeKeywordPlan, args));
    server.registerTool("create_keyword_plan_campaign", { description: "Create a keyword plan campaign.", inputSchema: CreateKeywordPlanCampaignSchema.shape }, args => asTool(createKeywordPlanCampaign, args));
    server.registerTool("create_keyword_plan_ad_group", { description: "Create a keyword plan ad group.", inputSchema: CreateKeywordPlanAdGroupSchema.shape }, args => asTool(createKeywordPlanAdGroup, args));
    server.registerTool("add_keyword_plan_keywords", { description: "Add keywords to a keyword plan ad group.", inputSchema: AddKeywordPlanKeywordsSchema.shape }, args => asTool(addKeywordPlanKeywords, args));
}
