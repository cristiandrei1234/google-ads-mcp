import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
const SetCampaignGeoTargetingSchema = BaseSchema.extend({
    campaignId: z.string(),
    addGeoTargetConstantIds: z.array(z.string()).default([]),
    removeCriterionIds: z.array(z.string()).default([]),
    negative: z.boolean().default(false),
});
async function setCampaignGeoTargeting(args: z.infer<typeof SetCampaignGeoTargetingSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const operations: any[] = [];
    for (const geoId of args.addGeoTargetConstantIds) {
        operations.push({
            campaign_criterion_operation: {
                create: {
                    campaign: `customers/${args.customerId}/campaigns/${args.campaignId}`,
                    negative: args.negative,
                    location: {
                        geo_target_constant: `geoTargetConstants/${geoId}`,
                    },
                },
            },
        });
    }
    for (const criterionId of args.removeCriterionIds) {
        operations.push({
            campaign_criterion_operation: {
                remove: `customers/${args.customerId}/campaignCriteria/${args.campaignId}~${criterionId}`,
            },
        });
    }
    if (operations.length === 0) {
        return { message: "No geo targeting changes requested." };
    }
    const results = [];
    for (const opsChunk of chunk(operations, 100)) {
        results.push(await runMutation(customer, opsChunk));
    }
    return { operations: operations.length, results };
}
const SetCampaignLanguageTargetingSchema = BaseSchema.extend({
    campaignId: z.string(),
    addLanguageConstantIds: z.array(z.string()).default([]),
    removeCriterionIds: z.array(z.string()).default([]),
    negative: z.boolean().default(false),
});
async function setCampaignLanguageTargeting(args: z.infer<typeof SetCampaignLanguageTargetingSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const operations: any[] = [];
    for (const languageId of args.addLanguageConstantIds) {
        operations.push({
            campaign_criterion_operation: {
                create: {
                    campaign: `customers/${args.customerId}/campaigns/${args.campaignId}`,
                    negative: args.negative,
                    language: {
                        language_constant: `languageConstants/${languageId}`,
                    },
                },
            },
        });
    }
    for (const criterionId of args.removeCriterionIds) {
        operations.push({
            campaign_criterion_operation: {
                remove: `customers/${args.customerId}/campaignCriteria/${args.campaignId}~${criterionId}`,
            },
        });
    }
    if (operations.length === 0) {
        return { message: "No language targeting changes requested." };
    }
    const results = [];
    for (const opsChunk of chunk(operations, 100)) {
        results.push(await runMutation(customer, opsChunk));
    }
    return { operations: operations.length, results };
}
const DeviceTypeMap: Record<"MOBILE" | "TABLET" | "DESKTOP", number> = {
    MOBILE: 2,
    TABLET: 3,
    DESKTOP: 4,
};
const SetCampaignDeviceModifiersSchema = BaseSchema.extend({
    campaignId: z.string(),
    modifiers: z.array(z.object({
        deviceType: z.enum(["MOBILE", "TABLET", "DESKTOP"]),
        bidModifier: z.number().min(0),
    })),
});
async function setCampaignDeviceModifiers(args: z.infer<typeof SetCampaignDeviceModifiersSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const rows: any[] = await runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT campaign_criterion.resource_name, campaign_criterion.device.type
            FROM campaign_criterion
            WHERE campaign.id = ${args.campaignId}
              AND campaign_criterion.type = DEVICE`,
    });
    const byType = new Map<number, string>();
    for (const row of rows) {
        const resourceName = row?.campaign_criterion?.resource_name;
        const type = Number(row?.campaign_criterion?.device?.type || 0);
        if (resourceName && type > 0)
            byType.set(type, String(resourceName));
    }
    const operations: any[] = [];
    for (const modifier of args.modifiers) {
        const resourceName = byType.get(DeviceTypeMap[modifier.deviceType]);
        if (!resourceName) {
            throw new Error(`Device criterion not found for ${modifier.deviceType}.`);
        }
        operations.push({
            campaign_criterion_operation: {
                update: {
                    resource_name: resourceName,
                    bid_modifier: modifier.bidModifier,
                },
                update_mask: { paths: ["bid_modifier"] },
            },
        });
    }
    return runMutation(customer, operations);
}
const SetCampaignAdScheduleSchema = BaseSchema.extend({
    campaignId: z.string(),
    addSchedules: z
        .array(z.object({
        dayOfWeek: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
        startHour: z.number().int().min(0).max(23),
        startMinute: z.union([z.literal("ZERO"), z.literal("FIFTEEN"), z.literal("THIRTY"), z.literal("FORTY_FIVE")]),
        endHour: z.number().int().min(1).max(24),
        endMinute: z.union([z.literal("ZERO"), z.literal("FIFTEEN"), z.literal("THIRTY"), z.literal("FORTY_FIVE")]),
        bidModifier: z.number().positive().optional(),
    }))
        .default([]),
    removeCriterionIds: z.array(z.string()).default([]),
});
async function setCampaignAdSchedule(args: z.infer<typeof SetCampaignAdScheduleSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const operations: any[] = [];
    for (const schedule of args.addSchedules) {
        const create: any = {
            campaign: `customers/${args.customerId}/campaigns/${args.campaignId}`,
            ad_schedule: {
                day_of_week: schedule.dayOfWeek,
                start_hour: schedule.startHour,
                start_minute: schedule.startMinute,
                end_hour: schedule.endHour,
                end_minute: schedule.endMinute,
            },
        };
        if (schedule.bidModifier != null) {
            create.bid_modifier = schedule.bidModifier;
        }
        operations.push({
            campaign_criterion_operation: { create },
        });
    }
    for (const criterionId of args.removeCriterionIds) {
        operations.push({
            campaign_criterion_operation: {
                remove: `customers/${args.customerId}/campaignCriteria/${args.campaignId}~${criterionId}`,
            },
        });
    }
    if (operations.length === 0) {
        return { message: "No ad schedule changes requested." };
    }
    const results = [];
    for (const opsChunk of chunk(operations, 100)) {
        results.push(await runMutation(customer, opsChunk));
    }
    return { operations: operations.length, results };
}
const SetCampaignContentExclusionsSchema = BaseSchema.extend({
    campaignId: z.string(),
    excludedPlacementUrls: z.array(z.string().url()).default([]),
    excludedTopicConstantIds: z.array(z.string()).default([]),
    removeCriterionIds: z.array(z.string()).default([]),
});
async function setCampaignContentExclusions(args: z.infer<typeof SetCampaignContentExclusionsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const operations: any[] = [];
    for (const url of args.excludedPlacementUrls) {
        operations.push({
            campaign_criterion_operation: {
                create: {
                    campaign: `customers/${args.customerId}/campaigns/${args.campaignId}`,
                    negative: true,
                    placement: { url },
                },
            },
        });
    }
    for (const topicId of args.excludedTopicConstantIds) {
        operations.push({
            campaign_criterion_operation: {
                create: {
                    campaign: `customers/${args.customerId}/campaigns/${args.campaignId}`,
                    negative: true,
                    topic: { topic_constant: `topicConstants/${topicId}` },
                },
            },
        });
    }
    for (const criterionId of args.removeCriterionIds) {
        operations.push({
            campaign_criterion_operation: {
                remove: `customers/${args.customerId}/campaignCriteria/${args.campaignId}~${criterionId}`,
            },
        });
    }
    if (operations.length === 0) {
        return { message: "No content exclusion changes requested." };
    }
    const results = [];
    for (const opsChunk of chunk(operations, 100)) {
        results.push(await runMutation(customer, opsChunk));
    }
    return { operations: operations.length, results };
}
const SetCampaignBiddingStrategySchema = BaseSchema.extend({
    campaignId: z.string(),
    strategy: z.enum(["MANUAL_CPC", "MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE", "TARGET_CPA", "TARGET_ROAS"]),
    targetCpaMicros: z.number().int().positive().optional(),
    targetRoas: z.number().positive().optional(),
});
async function setCampaignBiddingStrategy(args: z.infer<typeof SetCampaignBiddingStrategySchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const update: any = {
        resource_name: `customers/${args.customerId}/campaigns/${args.campaignId}`,
    };
    const paths: string[] = [];
    if (args.strategy === "MANUAL_CPC") {
        update.manual_cpc = {};
        paths.push("manual_cpc");
    }
    else if (args.strategy === "MAXIMIZE_CONVERSIONS") {
        update.maximize_conversions = args.targetCpaMicros ? { target_cpa_micros: args.targetCpaMicros } : {};
        paths.push("maximize_conversions");
        if (args.targetCpaMicros)
            paths.push("maximize_conversions.target_cpa_micros");
    }
    else if (args.strategy === "MAXIMIZE_CONVERSION_VALUE") {
        update.maximize_conversion_value = args.targetRoas ? { target_roas: args.targetRoas } : {};
        paths.push("maximize_conversion_value");
        if (args.targetRoas)
            paths.push("maximize_conversion_value.target_roas");
    }
    else if (args.strategy === "TARGET_CPA") {
        update.target_cpa = args.targetCpaMicros ? { target_cpa_micros: args.targetCpaMicros } : {};
        paths.push("target_cpa");
        if (args.targetCpaMicros)
            paths.push("target_cpa.target_cpa_micros");
    }
    else {
        update.target_roas = args.targetRoas ? { target_roas: args.targetRoas } : {};
        paths.push("target_roas");
        if (args.targetRoas)
            paths.push("target_roas.target_roas");
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
function escapeGaqlString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
const SetCampaignLabelsSchema = BaseSchema.extend({
    campaignId: z.string(),
    labelNames: z.array(z.string().min(1)).min(1),
    replace: z.boolean().default(true),
});
async function setCampaignLabels(args: z.infer<typeof SetCampaignLabelsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const escapedNames = args.labelNames.map(name => `'${escapeGaqlString(name)}'`);
    const labelQuery = `SELECT label.resource_name, label.name FROM label WHERE label.name IN (${escapedNames.join(",")})`;
    const existing: any[] = await runQuery({ customerId: args.customerId, userId: args.userId, query: labelQuery });
    const existingByName = new Map<string, string>();
    for (const row of existing) {
        if (row?.label?.name && row?.label?.resource_name) {
            existingByName.set(String(row.label.name), String(row.label.resource_name));
        }
    }
    const missing = args.labelNames.filter(name => !existingByName.has(name));
    for (const nameChunk of chunk(missing, 100)) {
        if (nameChunk.length === 0)
            continue;
        await runMutation(customer, nameChunk.map(name => ({
            label_operation: {
                create: { name },
            },
        })));
    }
    const labelsNow: any[] = await runQuery({ customerId: args.customerId, userId: args.userId, query: labelQuery });
    const desired = new Set<string>(labelsNow.map(row => row?.label?.resource_name).filter(Boolean));
    const existingCampaignLabels: any[] = await runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT campaign_label.resource_name, campaign_label.label
            FROM campaign_label
            WHERE campaign.id = ${args.campaignId}`,
    });
    const operations: any[] = [];
    const existingSet = new Set<string>(existingCampaignLabels.map(row => row?.campaign_label?.label).filter(Boolean));
    for (const label of desired) {
        if (!existingSet.has(label)) {
            operations.push({
                campaign_label_operation: {
                    create: {
                        campaign: `customers/${args.customerId}/campaigns/${args.campaignId}`,
                        label,
                    },
                },
            });
        }
    }
    if (args.replace) {
        for (const row of existingCampaignLabels) {
            const label = row?.campaign_label?.label;
            const resourceName = row?.campaign_label?.resource_name;
            if (label && resourceName && !desired.has(String(label))) {
                operations.push({
                    campaign_label_operation: {
                        remove: String(resourceName),
                    },
                });
            }
        }
    }
    for (const opsChunk of chunk(operations, 100)) {
        if (opsChunk.length > 0) {
            await runMutation(customer, opsChunk);
        }
    }
    return {
        operations: operations.length,
        desiredLabels: desired.size,
    };
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
export function registerCampaignTargetingTools(server: McpServer) {
    server.registerTool("set_campaign_geo_targeting", { description: "Add/remove campaign geo criteria.", inputSchema: SetCampaignGeoTargetingSchema.shape }, args => asTool(setCampaignGeoTargeting, args));
    server.registerTool("set_campaign_language_targeting", { description: "Add/remove campaign language criteria.", inputSchema: SetCampaignLanguageTargetingSchema.shape }, args => asTool(setCampaignLanguageTargeting, args));
    server.registerTool("set_campaign_device_modifiers", { description: "Set campaign device bid modifiers.", inputSchema: SetCampaignDeviceModifiersSchema.shape }, args => asTool(setCampaignDeviceModifiers, args));
    server.registerTool("set_campaign_ad_schedule", { description: "Add/remove campaign ad schedule criteria.", inputSchema: SetCampaignAdScheduleSchema.shape }, args => asTool(setCampaignAdSchedule, args));
    server.registerTool("set_campaign_content_exclusions", { description: "Manage campaign content exclusions.", inputSchema: SetCampaignContentExclusionsSchema.shape }, args => asTool(setCampaignContentExclusions, args));
    server.registerTool("set_campaign_bidding_strategy", { description: "Set campaign bidding strategy.", inputSchema: SetCampaignBiddingStrategySchema.shape }, args => asTool(setCampaignBiddingStrategy, args));
    server.registerTool("set_campaign_labels", { description: "Attach/replace campaign labels.", inputSchema: SetCampaignLabelsSchema.shape }, args => asTool(setCampaignLabels, args));
}
