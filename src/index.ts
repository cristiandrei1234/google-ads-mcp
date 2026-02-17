import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { listAccounts, ListAccountsSchema } from "./tools/listAccounts";
import { runQuery, RunQuerySchema } from "./tools/runQuery";
import { pauseCampaign, PauseCampaignSchema, enableCampaign, EnableCampaignSchema, removeCampaign, RemoveCampaignSchema } from "./tools/campaigns";
import { pauseAdGroup, PauseAdGroupSchema, enableAdGroup, EnableAdGroupSchema, removeAdGroup, RemoveAdGroupSchema } from "./tools/adgroups";
import { addKeyword, AddKeywordToolSchema, pauseKeyword, PauseKeywordSchema, enableKeyword, EnableKeywordSchema, removeKeyword, RemoveKeywordSchema } from "./tools/keywords";
import { addAdGroupNegativeKeyword, AddAdGroupNegativeKeywordToolSchema, removeAdGroupNegativeKeyword, RemoveAdGroupNegativeKeywordToolSchema, addCampaignNegativeKeyword, AddCampaignNegativeKeywordToolSchema, removeCampaignNegativeKeyword, RemoveCampaignNegativeKeywordToolSchema } from "./tools/negativeKeywords";
import { listProducts, ListProductsSchema, getProduct, GetProductSchema, insertProduct, InsertProductSchema, deleteProduct, DeleteProductSchema } from "./tools/merchantCenter";
import { linkMerchantCenter, LinkMerchantCenterToolSchema, listMerchantCenterLinks, ListMerchantCenterLinksToolSchema, unlinkMerchantCenter, UnlinkMerchantCenterToolSchema } from "./tools/merchantLinking";
import { createUserList, CreateUserListToolSchema, listUserLists, ListUserListsToolSchema } from "./tools/audiences";
import { createConversionAction, CreateConversionActionToolSchema, listConversionActions, ListConversionActionsToolSchema, uploadClickConversion, UploadClickConversionToolSchema } from "./tools/conversions";
import { generateKeywordIdeas, GenerateKeywordIdeasToolSchema } from "./tools/keywordPlanner";
import { listRecommendations, ListRecommendationsToolSchema, applyRecommendation, ApplyRecommendationToolSchema, dismissRecommendation, DismissRecommendationToolSchema } from "./tools/recommendations";
import { getSearchTerms, GetSearchTermsToolSchema, getChangeHistory, GetChangeHistoryToolSchema } from "./tools/reporting";
import { createResponsiveSearchAd, CreateResponsiveSearchAdToolSchema, pauseAd, PauseAdToolSchema, enableAd, EnableAdToolSchema, removeAd, RemoveAdToolSchema } from "./tools/ads";
import { createTextAsset, CreateTextAssetToolSchema, createImageAsset, CreateImageAssetToolSchema, listAssets, ListAssetsToolSchema } from "./tools/assets";
import { listShoppingPerformance, ListShoppingPerformanceToolSchema, listListingGroups, ListListingGroupsToolSchema, listAssetGroupListingGroups, ListAssetGroupListingGroupsToolSchema } from "./tools/shopping";
import { createBatchJob, CreateBatchJobToolSchema, listBatchJobs, ListBatchJobsToolSchema, runBatchJob, RunBatchJobToolSchema, addBatchJobOperations, AddBatchJobOperationsToolSchema } from "./tools/batchJobs";
import { listInvoices, ListInvoicesToolSchema, listAccountBudgets, ListAccountBudgetsToolSchema, listBillingSetups, ListBillingSetupsToolSchema } from "./tools/billing";
import { startIdentityVerification, StartIdentityVerificationToolSchema, getIdentityVerification, GetIdentityVerificationToolSchema } from "./tools/identityVerification";
import { listLocalServicesLeads, ListLocalServicesLeadsToolSchema } from "./tools/localServices";
import { listPolicyFindings, ListPolicyFindingsToolSchema } from "./tools/policy";
import { listExperiments, ListExperimentsToolSchema, createExperiment, CreateExperimentToolSchema, listReachPlanLocations, ListReachPlanLocationsToolSchema, generateReachForecast, GenerateReachForecastToolSchema } from "./tools/experiments";
import { getUserStatus, GetUserStatusToolSchema } from "./tools/admin";
import { registerAccountAccessTools } from "./tools/accountAccess";
import { registerCampaignCrudTools } from "./tools/campaignCrud";
import { registerCampaignTargetingTools } from "./tools/campaignTargeting";
import { registerAdGroupAdvancedTools } from "./tools/adgroupsAdvanced";
import { registerAdsAdvancedTools } from "./tools/adsAdvanced";
import { registerKeywordsAdvancedTools } from "./tools/keywordsAdvanced";
import { registerNegativeKeywordListTools } from "./tools/negativeKeywordLists";
import { registerKeywordPlannerAdvancedTools } from "./tools/keywordPlannerAdvanced";
import { registerConversionsAdvancedTools } from "./tools/conversionsAdvanced";
import { registerCampaignCloneTools } from "./tools/campaignClone";
import { registerAssetsAdvancedTools } from "./tools/assetsAdvanced";
import { registerExperimentsAdvancedTools } from "./tools/experimentsAdvanced";
import { registerCustomerMatchTools } from "./tools/customerMatch";
import { registerCampaignDraftTools } from "./tools/campaignDrafts";
import { registerBiddingAdvancedTools } from "./tools/biddingAdvanced";
import { registerConversionGoalTools } from "./tools/conversionGoals";
import { registerAudiencesAdvancedTools } from "./tools/audiencesAdvanced";
import { registerAssetSetsSignalsTools } from "./tools/assetSetsSignals";
import { registerVerticalTools } from "./tools/verticals";
import { registerMutateCoverageV23Tools } from "./tools/mutateCoverageV23";
import { registerReadParityTools } from "./tools/readParity";
import { checkPermission } from "./policies/rbac";
import logger from "./observability/logger";
// Create an MCP server
const server = new McpServer({
    name: "google-ads-mcp",
    version: "1.0.0",
});
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
function withRbac(toolName: string, handler: RegisteredToolHandler): RegisteredToolHandler {
    return async (...toolArgs: any[]) => {
        const customerId = extractCustomerIdFromArgs(toolArgs[0]);
        if (!checkPermission(toolName, customerId)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: Access denied for tool ${toolName}${customerId ? ` (customer ${customerId})` : ""}.`,
                    },
                ],
                isError: true,
            };
        }
        try {
            return await handler(...toolArgs);
        }
        catch (error: any) {
            return {
                content: [{ type: "text", text: `Error: ${error?.message || "Unknown error"}` }],
                isError: true,
            };
        }
    };
}
const originalRegisterTool = server.registerTool.bind(server);
(server as any).registerTool = (...allArgs: any[]) => {
    const [name, config, handler] = allArgs;
    if (typeof name !== "string") {
        return (originalRegisterTool as any)(...allArgs);
    }
    if (config && typeof config === "object" && typeof handler === "function") {
        return (originalRegisterTool as any)(name, config, withRbac(name, handler));
    }
    throw new Error(`registerTool must use modern signature: registerTool(name, config, handler). Invalid call for ${name}.`);
};
// Register the 'list_accessible_accounts' tool
server.registerTool("list_accessible_accounts", { description: "List all Google Ads accounts accessible with the current credentials.", inputSchema: ListAccountsSchema.shape }, async (args) => {
    try {
        const accounts = await listAccounts(args);
        return {
            content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register the 'run_gaql_query' tool
server.registerTool("run_gaql_query", { description: "Run a Google Ads Query Language (GAQL) query against a specific customer ID.", inputSchema: RunQuerySchema.shape }, async (args) => {
    try {
        const results = await runQuery(args);
        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register SaaS Admin tools
server.registerTool("get_user_status", { description: "Get the status of a SaaS user (linked accounts, connection status).", inputSchema: GetUserStatusToolSchema.shape }, async (args) => {
    try {
        const status = await getUserStatus(args);
        return {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Campaign management tools
server.registerTool("pause_campaign", { description: "Pause a campaign by ID.", inputSchema: PauseCampaignSchema.shape }, async (args) => {
    try {
        const result = await pauseCampaign(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("enable_campaign", { description: "Enable a campaign by ID.", inputSchema: EnableCampaignSchema.shape }, async (args) => {
    try {
        const result = await enableCampaign(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("remove_campaign", { description: "Remove (delete) a campaign by ID.", inputSchema: RemoveCampaignSchema.shape }, async (args) => {
    try {
        const result = await removeCampaign(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Ad Group management tools
server.registerTool("pause_ad_group", { description: "Pause an ad group by ID.", inputSchema: PauseAdGroupSchema.shape }, async (args) => {
    try {
        const result = await pauseAdGroup(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("enable_ad_group", { description: "Enable an ad group by ID.", inputSchema: EnableAdGroupSchema.shape }, async (args) => {
    try {
        const result = await enableAdGroup(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("remove_ad_group", { description: "Remove (delete) an ad group by ID.", inputSchema: RemoveAdGroupSchema.shape }, async (args) => {
    try {
        const result = await removeAdGroup(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Keyword management tools
server.registerTool("add_keyword", { description: "Add a keyword to an ad group.", inputSchema: AddKeywordToolSchema.shape }, async (args) => {
    try {
        const result = await addKeyword(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("pause_keyword", { description: "Pause a keyword by ID.", inputSchema: PauseKeywordSchema.shape }, async (args) => {
    try {
        const result = await pauseKeyword(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("enable_keyword", { description: "Enable a keyword by ID.", inputSchema: EnableKeywordSchema.shape }, async (args) => {
    try {
        const result = await enableKeyword(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("remove_keyword", { description: "Remove (delete) a keyword by ID.", inputSchema: RemoveKeywordSchema.shape }, async (args) => {
    try {
        const result = await removeKeyword(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Negative Keyword management tools
server.registerTool("add_ad_group_negative_keyword", { description: "Add a negative keyword to an ad group.", inputSchema: AddAdGroupNegativeKeywordToolSchema.shape }, async (args) => {
    try {
        const result = await addAdGroupNegativeKeyword(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("remove_ad_group_negative_keyword", { description: "Remove a negative keyword from an ad group.", inputSchema: RemoveAdGroupNegativeKeywordToolSchema.shape }, async (args) => {
    try {
        const result = await removeAdGroupNegativeKeyword(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("add_campaign_negative_keyword", { description: "Add a negative keyword to a campaign.", inputSchema: AddCampaignNegativeKeywordToolSchema.shape }, async (args) => {
    try {
        const result = await addCampaignNegativeKeyword(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("remove_campaign_negative_keyword", { description: "Remove a negative keyword from a campaign.", inputSchema: RemoveCampaignNegativeKeywordToolSchema.shape }, async (args) => {
    try {
        const result = await removeCampaignNegativeKeyword(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Merchant Center tools
server.registerTool("list_products", { description: "List products from Merchant Center.", inputSchema: ListProductsSchema.shape }, async (args) => {
    try {
        const result = await listProducts(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("get_product", { description: "Get a specific product from Merchant Center.", inputSchema: GetProductSchema.shape }, async (args) => {
    try {
        const result = await getProduct(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("insert_product", { description: "Insert or update a product in Merchant Center.", inputSchema: InsertProductSchema.shape }, async (args) => {
    try {
        const result = await insertProduct(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("delete_product", { description: "Delete a product from Merchant Center.", inputSchema: DeleteProductSchema.shape }, async (args) => {
    try {
        const result = await deleteProduct(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("link_merchant_center", { description: "Link a Merchant Center account to a Google Ads account.", inputSchema: LinkMerchantCenterToolSchema.shape }, async (args) => {
    try {
        const result = await linkMerchantCenter(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_merchant_center_links", { description: "List linked Merchant Center accounts.", inputSchema: ListMerchantCenterLinksToolSchema.shape }, async (args) => {
    try {
        const result = await listMerchantCenterLinks(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("unlink_merchant_center", { description: "Unlink a Merchant Center account from a Google Ads account.", inputSchema: UnlinkMerchantCenterToolSchema.shape }, async (args) => {
    try {
        const result = await unlinkMerchantCenter(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Audience tools
server.registerTool("create_user_list", { description: "Create a user list (audience).", inputSchema: CreateUserListToolSchema.shape }, async (args) => {
    try {
        const result = await createUserList(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_user_lists", { description: "List user lists (audiences).", inputSchema: ListUserListsToolSchema.shape }, async (args) => {
    try {
        const result = await listUserLists(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Conversion tools
server.registerTool("create_conversion_action", { description: "Create a conversion action.", inputSchema: CreateConversionActionToolSchema.shape }, async (args) => {
    try {
        const result = await createConversionAction(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_conversion_actions", { description: "List conversion actions.", inputSchema: ListConversionActionsToolSchema.shape }, async (args) => {
    try {
        const result = await listConversionActions(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("upload_click_conversion", { description: "Upload an offline click conversion.", inputSchema: UploadClickConversionToolSchema.shape }, async (args) => {
    try {
        const result = await uploadClickConversion(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Keyword Planner tools
server.registerTool("generate_keyword_ideas", { description: "Generate keyword ideas.", inputSchema: GenerateKeywordIdeasToolSchema.shape }, async (args) => {
    try {
        const result = await generateKeywordIdeas(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Recommendation tools
server.registerTool("list_recommendations", { description: "List active recommendations.", inputSchema: ListRecommendationsToolSchema.shape }, async (args) => {
    try {
        const result = await listRecommendations(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("apply_recommendation", { description: "Apply a recommendation.", inputSchema: ApplyRecommendationToolSchema.shape }, async (args) => {
    try {
        const result = await applyRecommendation(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("dismiss_recommendation", { description: "Dismiss a recommendation.", inputSchema: DismissRecommendationToolSchema.shape }, async (args) => {
    try {
        const result = await dismissRecommendation(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Reporting tools
server.registerTool("get_search_terms", { description: "Get search terms report.", inputSchema: GetSearchTermsToolSchema.shape }, async (args) => {
    try {
        const result = await getSearchTerms(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("get_change_history", { description: "Get change history (change_event).", inputSchema: GetChangeHistoryToolSchema.shape }, async (args) => {
    try {
        const result = await getChangeHistory(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Ad management tools
server.registerTool("create_responsive_search_ad", { description: "Create a Responsive Search Ad.", inputSchema: CreateResponsiveSearchAdToolSchema.shape }, async (args) => {
    try {
        const result = await createResponsiveSearchAd(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("pause_ad", { description: "Pause an ad.", inputSchema: PauseAdToolSchema.shape }, async (args) => {
    try {
        const result = await pauseAd(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("enable_ad", { description: "Enable an ad.", inputSchema: EnableAdToolSchema.shape }, async (args) => {
    try {
        const result = await enableAd(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("remove_ad", { description: "Remove an ad.", inputSchema: RemoveAdToolSchema.shape }, async (args) => {
    try {
        const result = await removeAd(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Asset management tools
server.registerTool("create_text_asset", { description: "Create a text asset (e.g. for headlines/descriptions).", inputSchema: CreateTextAssetToolSchema.shape }, async (args) => {
    try {
        const result = await createTextAsset(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("create_image_asset", { description: "Create an image asset from a URL.", inputSchema: CreateImageAssetToolSchema.shape }, async (args) => {
    try {
        const result = await createImageAsset(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_assets", { description: "List assets (Text, Image, etc).", inputSchema: ListAssetsToolSchema.shape }, async (args) => {
    try {
        const result = await listAssets(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Shopping/PMax tools
server.registerTool("list_shopping_performance", { description: "List product performance (Standard Shopping).", inputSchema: ListShoppingPerformanceToolSchema.shape }, async (args) => {
    try {
        const result = await listShoppingPerformance(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_listing_groups", { description: "List standard shopping listing groups (product partitions).", inputSchema: ListListingGroupsToolSchema.shape }, async (args) => {
    try {
        const result = await listListingGroups(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_asset_group_listing_groups", { description: "List PMax asset group listing groups.", inputSchema: ListAssetGroupListingGroupsToolSchema.shape }, async (args) => {
    try {
        const result = await listAssetGroupListingGroups(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Batch Job tools
server.registerTool("create_batch_job", { description: "Create a new batch job.", inputSchema: CreateBatchJobToolSchema.shape }, async (args) => {
    try {
        const result = await createBatchJob(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_batch_jobs", { description: "List batch jobs.", inputSchema: ListBatchJobsToolSchema.shape }, async (args) => {
    try {
        const result = await listBatchJobs(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("add_batch_job_operations", { description: "Add operations to a batch job.", inputSchema: AddBatchJobOperationsToolSchema.shape }, async (args) => {
    try {
        const result = await addBatchJobOperations(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("run_batch_job", { description: "Run a batch job.", inputSchema: RunBatchJobToolSchema.shape }, async (args) => {
    try {
        const result = await runBatchJob(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Billing tools
server.registerTool("list_invoices", { description: "List invoices.", inputSchema: ListInvoicesToolSchema.shape }, async (args) => {
    try {
        const result = await listInvoices(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_account_budgets", { description: "List account budgets.", inputSchema: ListAccountBudgetsToolSchema.shape }, async (args) => {
    try {
        const result = await listAccountBudgets(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("list_billing_setups", { description: "List billing setups.", inputSchema: ListBillingSetupsToolSchema.shape }, async (args) => {
    try {
        const result = await listBillingSetups(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Identity Verification tools
server.registerTool("start_identity_verification", { description: "Start identity verification.", inputSchema: StartIdentityVerificationToolSchema.shape }, async (args) => {
    try {
        const result = await startIdentityVerification(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("get_identity_verification", { description: "Get identity verification status.", inputSchema: GetIdentityVerificationToolSchema.shape }, async (args) => {
    try {
        const result = await getIdentityVerification(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Local Services tools
server.registerTool("list_local_services_leads", { description: "List Local Services leads.", inputSchema: ListLocalServicesLeadsToolSchema.shape }, async (args) => {
    try {
        const result = await listLocalServicesLeads(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Policy tools
server.registerTool("list_policy_findings", { description: "List ads with policy issues.", inputSchema: ListPolicyFindingsToolSchema.shape }, async (args) => {
    try {
        const result = await listPolicyFindings(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Experiment tools
server.registerTool("list_experiments", { description: "List campaigns experiments.", inputSchema: ListExperimentsToolSchema.shape }, async (args) => {
    try {
        const result = await listExperiments(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("create_experiment", { description: "Create a new campaign experiment.", inputSchema: CreateExperimentToolSchema.shape }, async (args) => {
    try {
        const result = await createExperiment(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register Reach Planning tools
server.registerTool("list_reach_plan_locations", { description: "List locations for reach planning.", inputSchema: ListReachPlanLocationsToolSchema.shape }, async (args) => {
    try {
        const result = await listReachPlanLocations(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
server.registerTool("generate_reach_forecast", { description: "Generate a reach forecast.", inputSchema: GenerateReachForecastToolSchema.shape }, async (args) => {
    try {
        const result = await generateReachForecast(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// Register advanced coverage tools
registerAccountAccessTools(server);
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
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Google Ads MCP Server running on stdio");
}
main().catch((error) => {
    logger.error("Server error:", error);
    process.exit(1);
});
