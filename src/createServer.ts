import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import { registerMutateCoverageV23Tools } from "./tools/mutateCoverageV23.js";
import { registerReadParityTools } from "./tools/readParity.js";
import { z } from "zod";
import { can, isWriteTool } from "./policies/rbac.js";
import {
    isDestructiveTool,
    checkDestructiveConfirmation,
    CONFIRM_FIELD,
} from "./policies/destructive.js";
import { getIdentity } from "./auth/identityContext.js";
import { appendAuditLog, getGrantLevel } from "./services/db.js";
import { toErrorMessage } from "./observability/errorMessage.js";
import { asTool } from "./tools/_runtime.js";
import logger from "./observability/logger.js";

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
    void appendAuditLog({
        organizationId: identity.orgId,
        memberId: identity.memberId,
        userId: identity.userId,
        tool: toolName,
        customerId: customerId ?? null,
        outcome,
        errorKind: errorKind ?? null,
    }).catch((err) => logger.warn({ err, tool: toolName }, "audit log write failed"));
}

function withRbac(toolName: string, handler: RegisteredToolHandler): RegisteredToolHandler {
    return async (...toolArgs: any[]) => {
        const identity = getIdentity();
        // Strip any caller-supplied userId: identity comes from the authenticated
        // session, never from arguments (prevents tenant impersonation).
        if (toolArgs[0] && typeof toolArgs[0] === "object") {
            delete (toolArgs[0] as Record<string, unknown>).userId;
        }
        const customerId = extractCustomerIdFromArgs(toolArgs[0]);

        const verdict = can(identity, toolName);
        if (!verdict.allowed) {
            audit(toolName, customerId, "denied", "role");
            return {
                content: [{ type: "text", text: `Error: ${verdict.reason ?? "Access denied."}` }],
                isError: true,
            };
        }

        // Fine-grained: a write tool on a specific account requires a WRITE/ADMIN
        // grant, not merely a write-capable role.
        if (identity && customerId && isWriteTool(toolName)) {
            const level = await getGrantLevel(identity.userId, customerId, identity.orgId);
            if (level !== "WRITE" && level !== "ADMIN") {
                audit(toolName, customerId, "denied", "insufficient_grant");
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
            audit(toolName, customerId, "denied", "unconfirmed_destructive");
            return {
                content: [{ type: "text", text: `Error: ${confirmation.reason}` }],
                isError: true,
            };
        }

        try {
            const result = await handler(...toolArgs);
            // Tools that catch internally return {isError:true} instead of throwing;
            // record those as errors, not successes.
            const outcome = result && typeof result === "object" && (result as { isError?: unknown }).isError === true ? "error" : "ok";
            audit(toolName, customerId, outcome);
            return result;
        }
        catch (error: any) {
            audit(toolName, customerId, "error", error?.name);
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
    name: string,
    description: string,
    schema: { shape: z.ZodRawShape },
    handler: (args: any) => Promise<unknown>,
];

const SIMPLE_TOOLS: readonly SimpleToolEntry[] = [
    ["list_accessible_accounts", "List all Google Ads accounts accessible with the current credentials.", ListAccountsSchema, listAccounts],
    ["run_gaql_query", "Run a Google Ads Query Language (GAQL) query against a specific customer ID.", RunQuerySchema, runQuery],
    // SaaS Admin
    ["get_user_status", "Get the status of a SaaS user (linked accounts, connection status).", GetUserStatusToolSchema, getUserStatus],
    // Campaign management
    ["pause_campaign", "Pause a campaign by ID.", PauseCampaignSchema, pauseCampaign],
    ["enable_campaign", "Enable a campaign by ID.", EnableCampaignSchema, enableCampaign],
    ["remove_campaign", "Remove (delete) a campaign by ID.", RemoveCampaignSchema, removeCampaign],
    // Ad Group management
    ["pause_ad_group", "Pause an ad group by ID.", PauseAdGroupSchema, pauseAdGroup],
    ["enable_ad_group", "Enable an ad group by ID.", EnableAdGroupSchema, enableAdGroup],
    ["remove_ad_group", "Remove (delete) an ad group by ID.", RemoveAdGroupSchema, removeAdGroup],
    // Keyword management
    ["add_keyword", "Add a keyword to an ad group.", AddKeywordToolSchema, addKeyword],
    ["pause_keyword", "Pause a keyword by ID.", PauseKeywordSchema, pauseKeyword],
    ["enable_keyword", "Enable a keyword by ID.", EnableKeywordSchema, enableKeyword],
    ["remove_keyword", "Remove (delete) a keyword by ID.", RemoveKeywordSchema, removeKeyword],
    // Negative Keyword management
    ["add_ad_group_negative_keyword", "Add a negative keyword to an ad group.", AddAdGroupNegativeKeywordToolSchema, addAdGroupNegativeKeyword],
    ["remove_ad_group_negative_keyword", "Remove a negative keyword from an ad group.", RemoveAdGroupNegativeKeywordToolSchema, removeAdGroupNegativeKeyword],
    ["add_campaign_negative_keyword", "Add a negative keyword to a campaign.", AddCampaignNegativeKeywordToolSchema, addCampaignNegativeKeyword],
    ["remove_campaign_negative_keyword", "Remove a negative keyword from a campaign.", RemoveCampaignNegativeKeywordToolSchema, removeCampaignNegativeKeyword],
    // Merchant Center
    ["list_products", "List products from Merchant Center.", ListProductsSchema, listProducts],
    ["get_product", "Get a specific product from Merchant Center.", GetProductSchema, getProduct],
    ["insert_product", "Insert or update a product in Merchant Center.", InsertProductSchema, insertProduct],
    ["delete_product", "Delete a product from Merchant Center.", DeleteProductSchema, deleteProduct],
    ["link_merchant_center", "Link a Merchant Center account to a Google Ads account.", LinkMerchantCenterToolSchema, linkMerchantCenter],
    ["list_merchant_center_links", "List linked Merchant Center accounts.", ListMerchantCenterLinksToolSchema, listMerchantCenterLinks],
    ["unlink_merchant_center", "Unlink a Merchant Center account from a Google Ads account.", UnlinkMerchantCenterToolSchema, unlinkMerchantCenter],
    // Audiences
    ["create_user_list", "Create a user list (audience).", CreateUserListToolSchema, createUserList],
    ["list_user_lists", "List user lists (audiences).", ListUserListsToolSchema, listUserLists],
    // Conversions
    ["create_conversion_action", "Create a conversion action.", CreateConversionActionToolSchema, createConversionAction],
    ["list_conversion_actions", "List conversion actions.", ListConversionActionsToolSchema, listConversionActions],
    ["upload_click_conversion", "Upload an offline click conversion.", UploadClickConversionToolSchema, uploadClickConversion],
    // Keyword Planner
    ["generate_keyword_ideas", "Generate keyword ideas.", GenerateKeywordIdeasToolSchema, generateKeywordIdeas],
    // Recommendations
    ["list_recommendations", "List active recommendations.", ListRecommendationsToolSchema, listRecommendations],
    ["apply_recommendation", "Apply a recommendation.", ApplyRecommendationToolSchema, applyRecommendation],
    ["dismiss_recommendation", "Dismiss a recommendation.", DismissRecommendationToolSchema, dismissRecommendation],
    // Reporting
    ["get_search_terms", "Get search terms report.", GetSearchTermsToolSchema, getSearchTerms],
    ["get_change_history", "Get change history (change_event).", GetChangeHistoryToolSchema, getChangeHistory],
    // Ad management
    ["create_responsive_search_ad", "Create a Responsive Search Ad.", CreateResponsiveSearchAdToolSchema, createResponsiveSearchAd],
    ["pause_ad", "Pause an ad.", PauseAdToolSchema, pauseAd],
    ["enable_ad", "Enable an ad.", EnableAdToolSchema, enableAd],
    ["remove_ad", "Remove an ad.", RemoveAdToolSchema, removeAd],
    // Asset management
    ["create_text_asset", "Create a text asset (e.g. for headlines/descriptions).", CreateTextAssetToolSchema, createTextAsset],
    ["create_image_asset", "Create an image asset from a URL.", CreateImageAssetToolSchema, createImageAsset],
    ["list_assets", "List assets (Text, Image, etc).", ListAssetsToolSchema, listAssets],
    // Shopping / PMax
    ["list_shopping_performance", "List product performance (Standard Shopping).", ListShoppingPerformanceToolSchema, listShoppingPerformance],
    ["list_listing_groups", "List standard shopping listing groups (product partitions).", ListListingGroupsToolSchema, listListingGroups],
    ["list_asset_group_listing_groups", "List PMax asset group listing groups.", ListAssetGroupListingGroupsToolSchema, listAssetGroupListingGroups],
    // Batch Jobs
    ["create_batch_job", "Create a new batch job.", CreateBatchJobToolSchema, createBatchJob],
    ["list_batch_jobs", "List batch jobs.", ListBatchJobsToolSchema, listBatchJobs],
    ["add_batch_job_operations", "Add operations to a batch job.", AddBatchJobOperationsToolSchema, addBatchJobOperations],
    ["run_batch_job", "Run a batch job.", RunBatchJobToolSchema, runBatchJob],
    // Billing
    ["list_invoices", "List invoices.", ListInvoicesToolSchema, listInvoices],
    ["list_account_budgets", "List account budgets.", ListAccountBudgetsToolSchema, listAccountBudgets],
    ["list_billing_setups", "List billing setups.", ListBillingSetupsToolSchema, listBillingSetups],
    // Identity Verification
    ["start_identity_verification", "Start identity verification.", StartIdentityVerificationToolSchema, startIdentityVerification],
    ["get_identity_verification", "Get identity verification status.", GetIdentityVerificationToolSchema, getIdentityVerification],
    // Local Services
    ["list_local_services_leads", "List Local Services leads.", ListLocalServicesLeadsToolSchema, listLocalServicesLeads],
    // Policy
    ["list_policy_findings", "List ads with policy issues.", ListPolicyFindingsToolSchema, listPolicyFindings],
    // Experiments
    ["list_experiments", "List campaigns experiments.", ListExperimentsToolSchema, listExperiments],
    ["create_experiment", "Create a new campaign experiment.", CreateExperimentToolSchema, createExperiment],
    // Reach Planning
    ["list_reach_plan_locations", "List locations for reach planning.", ListReachPlanLocationsToolSchema, listReachPlanLocations],
    ["generate_reach_forecast", "Generate a reach forecast.", GenerateReachForecastToolSchema, generateReachForecast],
];

/** Register one {@link SimpleToolEntry}; `asTool` supplies the uniform wrapper. */
function registerSimpleTool(server: McpServer, [name, description, schema, handler]: SimpleToolEntry): void {
    server.registerTool(name, { description, inputSchema: schema.shape }, (args: unknown) =>
        asTool(handler, args)
    );
}

// Build and fully configure the MCP server (all tools + RBAC + destructive
// guardrails). No transport is connected here, so this builder is reused by
// both the stdio entry (src/index.ts) and the HTTP transport (src/server/http.ts).
export function createMcpServer(): McpServer {
    const server = new McpServer({
        name: "google-ads-mcp",
        version: "1.0.0",
    });
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
        // Identity is never accepted from the client: strip the legacy `userId`
        // field from every tool's advertised input schema so it is not exposed
        // or validated. The authenticated session (ALS) is authoritative; tool
        // schemas keep userId internally only for transitional call-site typing.
        if (config.inputSchema && typeof config.inputSchema === "object" && "userId" in config.inputSchema) {
            const { userId: _removed, ...withoutUserId } = config.inputSchema;
            config.inputSchema = withoutUserId;
        }
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
        return (originalRegisterTool as any)(name, config, withRbac(name, handler));
    }
    throw new Error(`registerTool must use modern signature: registerTool(name, config, handler). Invalid call for ${name}.`);
};
// Register every "simple" tool from the declarative table above. The wrapped
// registerTool (RBAC + audit + destructive guard) and asTool (try/catch +
// toErrorMessage) supply all the cross-cutting behavior, so there is no
// per-tool boilerplate here.
for (const entry of SIMPLE_TOOLS) {
    registerSimpleTool(server, entry);
}
// Register advanced coverage tools
registerCampaignCrudTools(server);
registerCampaignTargetingTools(server);
registerCampaignCloneTools(server);
registerAdGroupAdvancedTools(server);
registerAdsAdvancedTools(server);
registerKeywordsAdvancedTools(server);
registerNegativeKeywordListTools(server);
registerKeywordPlannerAdvancedTools(server);
registerConversionsAdvancedTools(server);
registerAssetsAdvancedTools(server);
registerExperimentsAdvancedTools(server);
registerCustomerMatchTools(server);
registerCampaignDraftTools(server);
registerBiddingAdvancedTools(server);
registerConversionGoalTools(server);
registerAudiencesAdvancedTools(server);
registerAssetSetsSignalsTools(server);
registerVerticalTools(server);
registerMutateCoverageV23Tools(server);
registerReadParityTools(server);
    return server;
}
