import { createRequire } from "node:module";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAccounts, ListAccountsSchema } from "./tools/listAccounts.js";
import { runQuery, RunQuerySchema } from "./tools/runQuery.js";
import { pauseCampaign, PauseCampaignSchema, enableCampaign, EnableCampaignSchema, removeCampaign, RemoveCampaignSchema } from "./tools/campaigns.js";
import { pauseAdGroup, PauseAdGroupSchema, enableAdGroup, EnableAdGroupSchema, removeAdGroup, RemoveAdGroupSchema } from "./tools/adgroups.js";
import { addKeyword, AddKeywordToolSchema, pauseKeyword, PauseKeywordSchema, enableKeyword, EnableKeywordSchema, removeKeyword, RemoveKeywordSchema } from "./tools/keywords.js";
import { addAdGroupNegativeKeyword, AddAdGroupNegativeKeywordToolSchema, removeAdGroupNegativeKeyword, RemoveAdGroupNegativeKeywordToolSchema, addCampaignNegativeKeyword, AddCampaignNegativeKeywordToolSchema, removeCampaignNegativeKeyword, RemoveCampaignNegativeKeywordToolSchema } from "./tools/negativeKeywords.js";
import { listProducts, ListProductsSchema, getProduct, GetProductSchema, insertProduct, InsertProductSchema, deleteProduct, DeleteProductSchema } from "./tools/merchantCenter.js";
import { linkMerchantCenter, LinkMerchantCenterToolSchema, listMerchantCenterLinks, ListMerchantCenterLinksToolSchema, unlinkMerchantCenter, UnlinkMerchantCenterToolSchema } from "./tools/merchantLinking.js";
import { createUserList, CreateUserListToolSchema, listUserLists, ListUserListsToolSchema } from "./tools/audiences.js";
import { createConversionAction, CreateConversionActionToolSchema, listConversionActions, ListConversionActionsToolSchema, uploadClickConversion, UploadClickConversionToolSchema } from "./tools/conversions.js";
import { generateKeywordIdeas, GenerateKeywordIdeasToolSchema } from "./tools/keywordPlanner.js";
import { listRecommendations, ListRecommendationsToolSchema, applyRecommendation, ApplyRecommendationToolSchema, dismissRecommendation, DismissRecommendationToolSchema } from "./tools/recommendations.js";
import { getSearchTerms, GetSearchTermsToolSchema, getChangeHistory, GetChangeHistoryToolSchema } from "./tools/reporting.js";
import { createResponsiveSearchAd, CreateResponsiveSearchAdToolSchema, pauseAd, PauseAdToolSchema, enableAd, EnableAdToolSchema, removeAd, RemoveAdToolSchema } from "./tools/ads.js";
import { createTextAsset, CreateTextAssetToolSchema, createImageAsset, CreateImageAssetToolSchema, listAssets, ListAssetsToolSchema } from "./tools/assets.js";
import { listShoppingPerformance, ListShoppingPerformanceToolSchema, listListingGroups, ListListingGroupsToolSchema, listAssetGroupListingGroups, ListAssetGroupListingGroupsToolSchema } from "./tools/shopping.js";
import { createBatchJob, CreateBatchJobToolSchema, listBatchJobs, ListBatchJobsToolSchema, runBatchJob, RunBatchJobToolSchema, addBatchJobOperations, AddBatchJobOperationsToolSchema } from "./tools/batchJobs.js";
import { listInvoices, ListInvoicesToolSchema, listAccountBudgets, ListAccountBudgetsToolSchema, listBillingSetups, ListBillingSetupsToolSchema } from "./tools/billing.js";
import { startIdentityVerification, StartIdentityVerificationToolSchema, getIdentityVerification, GetIdentityVerificationToolSchema } from "./tools/identityVerification.js";
import { listLocalServicesLeads, ListLocalServicesLeadsToolSchema } from "./tools/localServices.js";
import { listPolicyFindings, ListPolicyFindingsToolSchema } from "./tools/policy.js";
import { listExperiments, ListExperimentsToolSchema, createExperiment, CreateExperimentToolSchema, listReachPlanLocations, ListReachPlanLocationsToolSchema, generateReachForecast, GenerateReachForecastToolSchema } from "./tools/experiments.js";
import { getUserStatus, GetUserStatusToolSchema } from "./tools/admin.js";
import { registerCampaignCrudTools } from "./tools/campaignCrud.js";
import { registerCampaignTargetingTools } from "./tools/campaignTargeting.js";
import { registerAdGroupAdvancedTools } from "./tools/adgroupsAdvanced.js";
import { registerAdsAdvancedTools } from "./tools/adsAdvanced.js";
import { registerKeywordsAdvancedTools } from "./tools/keywordsAdvanced.js";
import { registerNegativeKeywordListTools } from "./tools/negativeKeywordLists.js";
import { registerKeywordPlannerAdvancedTools } from "./tools/keywordPlannerAdvanced.js";
import { registerConversionsAdvancedTools } from "./tools/conversionsAdvanced.js";
import { registerCampaignCloneTools } from "./tools/campaignClone.js";
import { registerAssetsAdvancedTools } from "./tools/assetsAdvanced.js";
import { registerExperimentsAdvancedTools } from "./tools/experimentsAdvanced.js";
import { registerCustomerMatchTools } from "./tools/customerMatch.js";
import { registerCampaignDraftTools } from "./tools/campaignDrafts.js";
import { registerBiddingAdvancedTools } from "./tools/biddingAdvanced.js";
import { registerConversionGoalTools } from "./tools/conversionGoals.js";
import { registerAudiencesAdvancedTools } from "./tools/audiencesAdvanced.js";
import { registerAssetSetsSignalsTools } from "./tools/assetSetsSignals.js";
import { registerVerticalTools } from "./tools/verticals.js";
import { registerResourceMutationTools } from "./tools/resourceMutations.js";
import { registerResourceReadTools } from "./tools/resourceReads.js";
import { z } from "zod";
import { can, isWriteTool } from "./policies/rbac.js";
import {
    isDestructiveTool,
    checkDestructiveConfirmation,
    CONFIRM_FIELD,
} from "./policies/destructive.js";
import { getIdentity } from "./auth/identityContext.js";
import config, { hasDatabase } from "./config/env.js";
import { resolveToolsets, TOOLSETS, type Toolset } from "./policies/toolsets.js";
import {
    EnableToolsetSchema,
    enableToolsetDescription,
    enableToolsets,
    type ToolsetMember,
} from "./tools/toolsetControl.js";
import { toErrorMessage } from "./observability/errorMessage.js";
import { asTool, maxResultChars } from "./tools/_runtime.js";
import logger from "./observability/logger.js";
import { recordToolInvocation } from "./observability/metrics.js";
import { withToolSpan } from "./observability/tracing.js";

type RegisteredToolHandler = (...toolArgs: any[]) => Promise<any> | any;
function extractCustomerIdFromArgs(args: unknown): string | undefined {
    if (!args || typeof args !== "object") {
        return undefined;
    }
    const objectArgs = args as Record<string, unknown>;
    const rawCustomerId = objectArgs.customerId ?? objectArgs.customer_id;
    if (typeof rawCustomerId !== "string") {
        return undefined;
    }
    return rawCustomerId.replace(/-/g, "");
}

/** Append an audit row when an org-scoped identity is present (HTTP mode). */
function audit(
    toolName: string,
    customerId: string | undefined,
    outcome: "ok" | "error" | "denied",
    errorKind?: string
): void {
    const identity = getIdentity();
    if (!identity?.orgId) {
        return; // single-operator/stdio: nothing to attribute to an org.
    }
    const { orgId, memberId, userId } = identity;
    // Imported past the guard above so a stdio process never loads Prisma.
    void import("./services/db.js")
        .then(({ appendAuditLog }) =>
            appendAuditLog({
                organizationId: orgId,
                memberId,
                tool: toolName,
                customerId: customerId ?? null,
                outcome,
                errorKind: errorKind ?? null,
            })
        )
        .catch((err) => logger.warn({ err, tool: toolName }, "audit log write failed"));
}

function withRbac(toolName: string, handler: RegisteredToolHandler): RegisteredToolHandler {
    return async (...toolArgs: any[]) => {
        const startedAt = Date.now();
        // Record both the audit row (org-scoped, persisted) and the Prometheus
        // metric (always, incl. single-operator/stdio) at every terminal outcome.
        const finish = (
            customerId: string | undefined,
            outcome: "ok" | "error" | "denied",
            errorKind?: string
        ) => {
            audit(toolName, customerId, outcome, errorKind);
            recordToolInvocation(toolName, outcome, (Date.now() - startedAt) / 1000);
        };
        const identity = getIdentity();
        // Belt and braces: no schema advertises `userId` any more (so the SDK
        // strips it before we ever see it), but identity must never be readable
        // from arguments, and a future tool could register a passthrough schema.
        if (toolArgs[0] && typeof toolArgs[0] === "object") {
            delete (toolArgs[0] as Record<string, unknown>).userId;
        }
        const customerId = extractCustomerIdFromArgs(toolArgs[0]);

        const verdict = can(identity, toolName);
        if (!verdict.allowed) {
            finish(customerId, "denied", "role");
            return {
                content: [{ type: "text", text: `Error: ${verdict.reason ?? "Access denied."}` }],
                isError: true,
            };
        }

        // Fine-grained: a write tool on a specific account requires a WRITE/ADMIN
        // grant, not merely a write-capable role.
        if (identity && customerId && isWriteTool(toolName)) {
            // Only reachable with an authenticated identity, i.e. HTTP mode.
            const { getGrantLevel } = await import("./services/db.js");
            const level = await getGrantLevel(identity.userId, customerId, identity.orgId);
            if (level !== "WRITE" && level !== "ADMIN") {
                finish(customerId, "denied", "insufficient_grant");
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: '${toolName}' on customer ${customerId} requires a WRITE grant (have: ${level ?? "none"}).`,
                        },
                    ],
                    isError: true,
                };
            }
        }

        const confirmation = checkDestructiveConfirmation(toolName, toolArgs[0]);
        if (!confirmation.allowed) {
            finish(customerId, "denied", "unconfirmed_destructive");
            return {
                content: [{ type: "text", text: `Error: ${confirmation.reason}` }],
                isError: true,
            };
        }

        try {
            const result = await withToolSpan(
                `tool:${toolName}`,
                { "mcp.tool": toolName, "mcp.customer_id": customerId ?? "", "enduser.id": identity?.userId ?? "" },
                () => Promise.resolve(handler(...toolArgs))
            );
            // Tools that catch internally return {isError:true} instead of throwing;
            // record those as errors, not successes.
            const outcome = result && typeof result === "object" && (result as { isError?: unknown }).isError === true ? "error" : "ok";
            finish(customerId, outcome);
            return result;
        }
        catch (error: any) {
            finish(customerId, "error", error?.name);
            logger.error({ err: error, tool: toolName, customerId, requestId: identity?.requestId }, "tool execution failed");
            return {
                content: [{ type: "text", text: `Error: ${toErrorMessage(error)}` }],
                isError: true,
            };
        }
    };
}

/**
 * One "simple" tool: a name, description, input schema, and the implementation.
 * These are tools that just run a function and JSON-stringify the result; the
 * `asTool` wrapper supplies the uniform try/catch + error rendering, so they
 * need no per-tool boilerplate. (Tools with bespoke registration logic live in
 * their own `register*Tools` modules — see the calls at the end of the builder.)
 */
type SimpleToolEntry = readonly [
    toolset: Toolset,
    name: string,
    description: string,
    schema: { shape: z.ZodRawShape },
    handler: (args: any) => Promise<unknown>,
];

const SIMPLE_TOOLS: readonly SimpleToolEntry[] = [
    ["core", "list_accessible_accounts", "List the Google Ads accounts (customer IDs) these credentials can reach, including client accounts under a manager (MCC).", ListAccountsSchema, listAccounts],
    ["core", "run_gaql_query", "Run a read-only GAQL query against one account: performance metrics, spend, and entity settings — anything the Google Ads UI reports. A LIMIT is added when the query has none.", RunQuerySchema, runQuery],
    // SaaS Admin
    ["admin", "get_user_status", "Report a user's organizations, linked Google Ads connections (MCCs) and per-account grants. Multi-tenant mode only.", GetUserStatusToolSchema, getUserStatus],
    // Campaign management
    ["core", "pause_campaign", "Pause a campaign so it stops serving and spending. Reversible with enable_campaign.", PauseCampaignSchema, pauseCampaign],
    ["core", "enable_campaign", "Resume a paused campaign so it serves and spends again.", EnableCampaignSchema, enableCampaign],
    ["core", "remove_campaign", "Permanently remove a campaign. Irreversible — pause_campaign is the reversible option.", RemoveCampaignSchema, removeCampaign],
    // Ad Group management
    ["core", "pause_ad_group", "Pause an ad group so its ads and keywords stop serving.", PauseAdGroupSchema, pauseAdGroup],
    ["core", "enable_ad_group", "Resume a paused ad group.", EnableAdGroupSchema, enableAdGroup],
    ["core", "remove_ad_group", "Permanently remove an ad group. Irreversible — pause_ad_group is the reversible option.", RemoveAdGroupSchema, removeAdGroup],
    // Keyword management
    ["core", "add_keyword", "Add a positive keyword to an ad group with a match type (EXACT, PHRASE or BROAD) and an optional CPC bid.", AddKeywordToolSchema, addKeyword],
    ["core", "pause_keyword", "Pause a keyword so it stops triggering ads and spending.", PauseKeywordSchema, pauseKeyword],
    ["core", "enable_keyword", "Resume a paused keyword.", EnableKeywordSchema, enableKeyword],
    ["core", "remove_keyword", "Permanently remove a keyword from its ad group. Irreversible.", RemoveKeywordSchema, removeKeyword],
    // Negative Keyword management
    ["negatives", "add_ad_group_negative_keyword", "Block a search term at ad group level by adding a negative keyword.", AddAdGroupNegativeKeywordToolSchema, addAdGroupNegativeKeyword],
    ["negatives", "remove_ad_group_negative_keyword", "Remove an ad group negative keyword so its search terms can trigger ads again.", RemoveAdGroupNegativeKeywordToolSchema, removeAdGroupNegativeKeyword],
    ["negatives", "add_campaign_negative_keyword", "Block a search term across a whole campaign by adding a campaign negative keyword.", AddCampaignNegativeKeywordToolSchema, addCampaignNegativeKeyword],
    ["negatives", "remove_campaign_negative_keyword", "Remove a campaign negative keyword so its search terms can trigger ads again.", RemoveCampaignNegativeKeywordToolSchema, removeCampaignNegativeKeyword],
    // Merchant Center
    ["shopping", "list_products", "List products in a Merchant Center feed with their offer IDs, titles and availability.", ListProductsSchema, listProducts],
    ["shopping", "get_product", "Read one Merchant Center product by product ID, including attributes and disapprovals.", GetProductSchema, getProduct],
    ["shopping", "insert_product", "Create or overwrite a product in a Merchant Center feed.", InsertProductSchema, insertProduct],
    ["shopping", "delete_product", "Delete a product from a Merchant Center feed. Irreversible.", DeleteProductSchema, deleteProduct],
    ["shopping", "link_merchant_center", "Link a Merchant Center account to a Google Ads account so Shopping and Performance Max campaigns can use its products.", LinkMerchantCenterToolSchema, linkMerchantCenter],
    ["shopping", "list_merchant_center_links", "List the Merchant Center accounts linked to a Google Ads account, with the status of each link.", ListMerchantCenterLinksToolSchema, listMerchantCenterLinks],
    ["shopping", "unlink_merchant_center", "Unlink a Merchant Center account from a Google Ads account. Shopping campaigns stop serving those products.", UnlinkMerchantCenterToolSchema, unlinkMerchantCenter],
    // Audiences
    ["audiences", "create_user_list", "Create a remarketing audience (user list) for targeting or exclusion.", CreateUserListToolSchema, createUserList],
    ["audiences", "list_user_lists", "List remarketing audiences (user lists) with their size and membership rules.", ListUserListsToolSchema, listUserLists],
    // Conversions
    ["conversions", "create_conversion_action", "Create a conversion action to track (purchase, lead, sign-up) with its counting, attribution and value settings.", CreateConversionActionToolSchema, createConversionAction],
    ["conversions", "list_conversion_actions", "List conversion actions with their category, status, counting type and attribution model.", ListConversionActionsToolSchema, listConversionActions],
    ["conversions", "upload_click_conversion", "Upload an offline conversion against a stored GCLID so conversions that happened off-site are attributed and can train Smart Bidding.", UploadClickConversionToolSchema, uploadClickConversion],
    // Keyword Planner
    ["planning", "generate_keyword_ideas", "Generate keyword ideas from seed terms or a landing page URL, with Keyword Planner search volume and competition.", GenerateKeywordIdeasToolSchema, generateKeywordIdeas],
    // Recommendations
    ["reporting", "list_recommendations", "List Google's active optimization recommendations for an account: budget, bidding, keyword and ad suggestions.", ListRecommendationsToolSchema, listRecommendations],
    ["reporting", "apply_recommendation", "Apply one of Google's optimization recommendations. Changes the account immediately.", ApplyRecommendationToolSchema, applyRecommendation],
    ["reporting", "dismiss_recommendation", "Dismiss an optimization recommendation so Google stops suggesting it.", DismissRecommendationToolSchema, dismissRecommendation],
    // Reporting
    ["reporting", "get_search_terms", "Get the search terms report: the queries people actually typed, with clicks, cost and conversions. The starting point for negative keyword and keyword mining work.", GetSearchTermsToolSchema, getSearchTerms],
    ["reporting", "get_change_history", "Get the account change history (change_event): what changed, when, and by whom. Use it to explain a sudden shift in performance.", GetChangeHistoryToolSchema, getChangeHistory],
    // Ad management
    ["core", "create_responsive_search_ad", "Create a Responsive Search Ad from headlines and descriptions, with optional pinning and display paths.", CreateResponsiveSearchAdToolSchema, createResponsiveSearchAd],
    ["core", "pause_ad", "Pause a single ad so it stops serving.", PauseAdToolSchema, pauseAd],
    ["core", "enable_ad", "Resume a paused ad.", EnableAdToolSchema, enableAd],
    ["core", "remove_ad", "Permanently remove an ad from its ad group. Irreversible.", RemoveAdToolSchema, removeAd],
    // Asset management
    ["assets", "create_text_asset", "Create a reusable text asset for headlines or descriptions, used by Performance Max and asset-based ads.", CreateTextAssetToolSchema, createTextAsset],
    ["assets", "create_image_asset", "Create an image asset from a URL, for Performance Max, Display and extensions.", CreateImageAssetToolSchema, createImageAsset],
    ["assets", "list_assets", "List the assets in an account (text, image, video and more) with their type and name.", ListAssetsToolSchema, listAssets],
    // Shopping / PMax
    ["shopping", "list_shopping_performance", "Report product-level Standard Shopping performance: impressions, clicks, cost and conversions per offer.", ListShoppingPerformanceToolSchema, listShoppingPerformance],
    ["shopping", "list_listing_groups", "List Standard Shopping listing groups (product partitions) and their bids.", ListListingGroupsToolSchema, listListingGroups],
    ["shopping", "list_asset_group_listing_groups", "List Performance Max asset group listing group filters — which products each asset group covers.", ListAssetGroupListingGroupsToolSchema, listAssetGroupListingGroups],
    // Batch Jobs
    ["resources", "create_batch_job", "Create a Google Ads batch job for large sets of mutations that must run asynchronously.", CreateBatchJobToolSchema, createBatchJob],
    ["resources", "list_batch_jobs", "List batch jobs with their status and progress.", ListBatchJobsToolSchema, listBatchJobs],
    ["resources", "add_batch_job_operations", "Add mutate operations to a pending batch job.", AddBatchJobOperationsToolSchema, addBatchJobOperations],
    ["resources", "run_batch_job", "Start a batch job. It runs asynchronously; poll list_batch_jobs for its status.", RunBatchJobToolSchema, runBatchJob],
    // Billing
    ["billing", "list_invoices", "List the invoices issued for an account's billing setup, by month.", ListInvoicesToolSchema, listInvoices],
    ["billing", "list_account_budgets", "List account budgets — the billing-level spend caps, not campaign budgets.", ListAccountBudgetsToolSchema, listAccountBudgets],
    ["billing", "list_billing_setups", "List billing setups: which payments account funds this Google Ads account.", ListBillingSetupsToolSchema, listBillingSetups],
    // Identity Verification
    ["billing", "start_identity_verification", "Start the advertiser identity verification Google requires to keep ads serving.", StartIdentityVerificationToolSchema, startIdentityVerification],
    ["billing", "get_identity_verification", "Check advertiser identity verification progress and its deadline.", GetIdentityVerificationToolSchema, getIdentityVerification],
    // Local Services
    ["reporting", "list_local_services_leads", "List Local Services Ads leads (calls and messages) with their status and charge.", ListLocalServicesLeadsToolSchema, listLocalServicesLeads],
    // Policy
    ["reporting", "list_policy_findings", "List ads that are disapproved or limited by policy, with the policy topic and the evidence Google cited.", ListPolicyFindingsToolSchema, listPolicyFindings],
    // Experiments
    ["experiments", "list_experiments", "List campaign experiments with their status, traffic split and dates.", ListExperimentsToolSchema, listExperiments],
    ["experiments", "create_experiment", "Create a campaign experiment (A/B test) from a draft, splitting traffic against the base campaign.", CreateExperimentToolSchema, createExperiment],
    // Reach Planning
    ["planning", "list_reach_plan_locations", "List the locations available for reach planning (YouTube and Display forecasts).", ListReachPlanLocationsToolSchema, listReachPlanLocations],
    ["planning", "generate_reach_forecast", "Forecast reach, impressions and frequency for a YouTube or Display plan before committing budget.", GenerateReachForecastToolSchema, generateReachForecast],
];

/**
 * Names whose results are bulk rows rather than a mutation acknowledgement.
 * Only these need to advertise the result ceiling to the client.
 */
function returnsBulkRows(toolName: string): boolean {
    return /^(list|get|run|search|generate)_/.test(toolName);
}

/**
 * The published package version, so the version a client reports cannot drift
 * from the one on npm. `../package.json` resolves to the package root from both
 * `src/` and `dist/`, and `files` ships it.
 */
function packageVersion(): string {
    const require = createRequire(import.meta.url);
    const { version } = require("../package.json") as { version: string };
    return version;
}

/** Prose the client shows the model before any tool is listed. */
function serverInstructions(enabled: ReadonlySet<Toolset>): string {
    return [
        "Read and manage live Google Ads accounts through the Google Ads API.",
        "",
        "Use these tools for any question about a real advertising account: spend and budgets,",
        "campaigns, ad groups, ads, keywords, negatives, search terms, conversions, audiences,",
        "assets and Performance Max, Shopping and Merchant Center, experiments, bidding and",
        "billing. Anything the Google Ads UI can show can also be read with a GAQL statement",
        "through run_gaql_query, so prefer that over guessing at numbers.",
        "",
        `Tools are grouped into toolsets: ${TOOLSETS.join(", ")}.`,
        `Registered in this session: ${[...enabled].join(", ")}.`,
        "Set GOOGLE_ADS_TOOLSETS (comma-separated, or 'all') to change which groups load.",
        "",
        "Two conventions every call must follow:",
        "- customerId is digits only, no dashes: 1234567890, not 123-456-7890.",
        "- Destructive tools (remove_*, delete_*, unlink_*, update_customer) refuse to run",
        "  unless you pass confirm: true.",
    ].join("\n");
}

/** Bespoke registration modules, each mapped to the toolset that owns it. */
const MODULE_REGISTRARS: ReadonlyArray<readonly [Toolset, (server: McpServer) => void]> = [
    ["core", registerCampaignCrudTools],
    ["core", registerCampaignTargetingTools],
    ["core", registerCampaignCloneTools],
    ["core", registerAdGroupAdvancedTools],
    ["core", registerAdsAdvancedTools],
    ["keywords", registerKeywordsAdvancedTools],
    ["negatives", registerNegativeKeywordListTools],
    ["planning", registerKeywordPlannerAdvancedTools],
    ["conversions", registerConversionsAdvancedTools],
    ["conversions", registerConversionGoalTools],
    ["assets", registerAssetsAdvancedTools],
    ["assets", registerAssetSetsSignalsTools],
    ["experiments", registerExperimentsAdvancedTools],
    ["experiments", registerCampaignDraftTools],
    ["audiences", registerCustomerMatchTools],
    ["audiences", registerAudiencesAdvancedTools],
    ["bidding", registerBiddingAdvancedTools],
    ["shopping", registerVerticalTools],
    ["resources", registerResourceMutationTools],
    ["resources", registerResourceReadTools],
];

/**
 * Tools backed by the multi-tenant database. Without DATABASE_URL they can only
 * fail, and every advertised tool costs the model context, so they are left
 * unregistered in single-operator mode.
 */
const DATABASE_BACKED_TOOLS: ReadonlySet<string> = new Set(["get_user_status"]);

/** Register one {@link SimpleToolEntry}; `asTool` supplies the uniform wrapper. */
function registerSimpleTool(server: McpServer, [, name, description, schema, handler]: SimpleToolEntry): void {
    server.registerTool(name, { description, inputSchema: schema.shape }, (args: unknown) =>
        asTool(handler, args)
    );
}

/**
 * Every registered tool with the group that owns it, so a group can be switched
 * on later. Only populated in dynamic mode.
 */
type ToolRegistry = Map<string, ToolsetMember & { disable(): void }>;

// Build and fully configure the MCP server (all tools + RBAC + destructive
// guardrails). No transport is connected here, so this builder is reused by
// both the stdio entry (src/index.ts) and the HTTP transport (src/server/http.ts).
export function createMcpServer(): McpServer {
    const enabledToolsets = resolveToolsets(config.GOOGLE_ADS_TOOLSETS);
    const dynamicToolsets = config.GOOGLE_ADS_DYNAMIC_TOOLSETS;
    const registry: ToolRegistry = new Map();
    // Registration is synchronous, so the group being registered can simply be
    // tracked alongside it; the interceptor below has no other way to know which
    // module a bespoke registrar is currently registering from.
    let registeringToolset: Toolset = "core";
    const server = new McpServer(
        {
            name: "google-ads-mcp",
            version: packageVersion(),
        },
        // Tells the model when to come looking for these tools at all. This
        // matters more, not less, once a client defers tool definitions behind a
        // search tool: the listing may not be in context, but this is.
        { instructions: serverInstructions(enabledToolsets) }
    );
    const originalRegisterTool = server.registerTool.bind(server);
    const registeredToolNames = new Set<string>();
(server as any).registerTool = (...allArgs: any[]) => {
    const [name, config, handler] = allArgs;
    if (typeof name !== "string") {
        return (originalRegisterTool as any)(...allArgs);
    }
    // Defensive de-dup: some coverage families overlap with hand-written
    // advanced tools (e.g. list_experiment_arms). First registration wins;
    // duplicates are skipped with a warning rather than crashing the server.
    if (registeredToolNames.has(name)) {
        logger.warn(`Duplicate tool registration skipped: ${name}`);
        return undefined;
    }
    registeredToolNames.add(name);
    if (config && typeof config === "object" && typeof handler === "function") {
        // Auto-inject a `confirm` field into destructive tools' input schema so
        // callers can acknowledge the action without touching each tool file.
        if (isDestructiveTool(name) && config.inputSchema && typeof config.inputSchema === "object" && !(CONFIRM_FIELD in config.inputSchema)) {
            config.inputSchema = {
                ...config.inputSchema,
                [CONFIRM_FIELD]: z
                    .boolean()
                    .optional()
                    .describe("Must be true to execute this destructive (irreversible) operation."),
            };
        }
        // Advertise the server's own result ceiling so the client truncates at
        // the same boundary instead of applying its smaller default.
        if (returnsBulkRows(name)) {
            config._meta = { ...config._meta, "anthropic/maxResultSizeChars": maxResultChars() };
        }
        const registered = (originalRegisterTool as any)(name, config, withRbac(name, handler)) as RegisteredTool;
        if (dynamicToolsets) {
            registry.set(name, {
                toolset: registeringToolset,
                get enabled() {
                    return registered.enabled;
                },
                enable: () => registered.enable(),
                disable: () => registered.disable(),
            });
        }
        return registered;
    }
    throw new Error(`registerTool must use modern signature: registerTool(name, config, handler). Invalid call for ${name}.`);
};
// Register every "simple" tool from the declarative table above. The wrapped
// registerTool (RBAC + audit + destructive guard) and asTool (try/catch +
// toErrorMessage) supply all the cross-cutting behavior, so there is no
// per-tool boilerplate here.
for (const entry of SIMPLE_TOOLS) {
    const [toolset, name] = entry;
    if (!dynamicToolsets && !enabledToolsets.has(toolset)) {
        continue;
    }
    if (DATABASE_BACKED_TOOLS.has(name) && !hasDatabase()) {
        continue;
    }
    registeringToolset = toolset;
    registerSimpleTool(server, entry);
}
// Tools with bespoke registration logic, each owned by one toolset. Outside
// dynamic mode a disabled group is skipped rather than registered and filtered,
// which is what keeps its tools out of tools/list entirely.
for (const [toolset, register] of MODULE_REGISTRARS) {
    if (!dynamicToolsets && !enabledToolsets.has(toolset)) {
        continue;
    }
    registeringToolset = toolset;
    register(server);
}

    if (dynamicToolsets) {
        for (const member of registry.values()) {
            if (!enabledToolsets.has(member.toolset)) {
                member.disable();
            }
        }
        registerEnableToolsetTool(server, registry);
    }
    return server;
}

/**
 * The switch the model reaches for when the tool it needs is not loaded.
 *
 * Registered last and never disabled, so it survives every toggle. Enabling a
 * tool makes the SDK emit tools/list_changed on its own; clients that ignore
 * that notification need GOOGLE_ADS_TOOLSETS instead.
 */
function registerEnableToolsetTool(server: McpServer, registry: ToolRegistry): void {
    server.registerTool(
        "enable_toolset",
        { description: enableToolsetDescription(), inputSchema: EnableToolsetSchema.shape },
        (args: unknown) =>
            asTool(
                async (input: z.infer<typeof EnableToolsetSchema>) =>
                    enableToolsets(registry, input.toolsets),
                args as z.infer<typeof EnableToolsetSchema>
            )
    );
}
