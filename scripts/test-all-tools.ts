import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { getUserStatus } from "../src/tools/admin";
import { pauseAdGroup, enableAdGroup, removeAdGroup } from "../src/tools/adgroups";
import { createResponsiveSearchAd, pauseAd, enableAd, removeAd } from "../src/tools/ads";
import { createTextAsset, createImageAsset, listAssets } from "../src/tools/assets";
import { createUserList, listUserLists } from "../src/tools/audiences";
import { createBatchJob, listBatchJobs, addBatchJobOperations, runBatchJob } from "../src/tools/batchJobs";
import { listInvoices, listAccountBudgets, listBillingSetups } from "../src/tools/billing";
import { pauseCampaign, enableCampaign, removeCampaign } from "../src/tools/campaigns";
import { createConversionAction, listConversionActions, uploadClickConversion } from "../src/tools/conversions";
import { listExperiments, createExperiment, listReachPlanLocations, generateReachForecast } from "../src/tools/experiments";
import { startIdentityVerification, getIdentityVerification } from "../src/tools/identityVerification";
import { generateKeywordIdeas } from "../src/tools/keywordPlanner";
import { addKeyword, pauseKeyword, enableKeyword, removeKeyword } from "../src/tools/keywords";
import { listAccounts } from "../src/tools/listAccounts";
import { listLocalServicesLeads } from "../src/tools/localServices";
import { listProducts, getProduct, insertProduct, deleteProduct } from "../src/tools/merchantCenter";
import { linkMerchantCenter, listMerchantCenterLinks, unlinkMerchantCenter } from "../src/tools/merchantLinking";
import {
  addAdGroupNegativeKeyword,
  removeAdGroupNegativeKeyword,
  addCampaignNegativeKeyword,
  removeCampaignNegativeKeyword,
} from "../src/tools/negativeKeywords";
import { listPolicyFindings } from "../src/tools/policy";
import { listRecommendations, applyRecommendation, dismissRecommendation } from "../src/tools/recommendations";
import { getSearchTerms, getChangeHistory } from "../src/tools/reporting";
import { runQuery } from "../src/tools/runQuery";
import {
  listShoppingPerformance,
  listListingGroups,
  listAssetGroupListingGroups,
} from "../src/tools/shopping";
import { listAudienceInsights, listHotelPerformance } from "../src/tools/verticals";
import { MUTATE_COVERAGE_V23_EXPECTED_TOOL_NAMES } from "../src/tools/mutateCoverageV23";
import { registerMutateCoverageV23Tools } from "../src/tools/mutateCoverageV23";
import { READ_PARITY_EXPECTED_TOOL_NAMES } from "../src/tools/readParity";
import { registerReadParityTools } from "../src/tools/readParity";

dotenv.config();

type Status = "pass" | "fail" | "skip";

type ToolResult = {
  name: string;
  status: Status;
  ms: number;
  details?: string;
};

function errToString(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function collectCoverageGeneratedToolNames(): Set<string> {
  const names = new Set<string>();
  const fakeServer = {
    registerTool: (name: string) => {
      names.add(name);
    },
  } as any;

  registerMutateCoverageV23Tools(fakeServer);
  registerReadParityTools(fakeServer);

  return names;
}

function hasCoverageRegistrationInIndex(): boolean {
  const repoRoot = path.resolve(__dirname, "..");
  const indexPath = path.join(repoRoot, "src", "index.ts");
  const content = fs.readFileSync(indexPath, "utf8");
  return (
    content.includes("registerMutateCoverageV23Tools(server);") &&
    content.includes("registerReadParityTools(server);")
  );
}

type GoogleAdsErrorEntry = {
  domain: string;
  code: string;
  message: string;
};

function extractGoogleAdsErrors(error: unknown): GoogleAdsErrorEntry[] {
  const rawErrors: any[] = [];

  if (error && typeof error === "object") {
    const topLevelErrors = (error as any).errors;
    if (Array.isArray(topLevelErrors)) {
      rawErrors.push(...topLevelErrors);
    }

    const statusDetails = (error as any).statusDetails;
    if (Array.isArray(statusDetails)) {
      for (const detail of statusDetails) {
        if (detail && typeof detail === "object" && Array.isArray((detail as any).errors)) {
          rawErrors.push(...(detail as any).errors);
        }
      }
    }
  }

  // Some tool wrappers throw Error where message is serialized JSON.
  if (rawErrors.length === 0 && error instanceof Error && typeof error.message === "string") {
    try {
      const parsed = JSON.parse(error.message);
      if (Array.isArray(parsed?.errors)) {
        rawErrors.push(...parsed.errors);
      }
    } catch {
      // Not a JSON message.
    }
  }
  if (rawErrors.length === 0) return [];

  const parsed: GoogleAdsErrorEntry[] = [];
  for (const rawError of rawErrors) {
    if (!rawError || typeof rawError !== "object") continue;
    const message = typeof rawError.message === "string" ? rawError.message : "";
    const errorCode = rawError.error_code;
    if (!errorCode || typeof errorCode !== "object") continue;

    for (const [domain, code] of Object.entries(errorCode)) {
      if (typeof code !== "string" && typeof code !== "number") continue;
      parsed.push({ domain, code: String(code), message });
    }
  }

  return parsed;
}

function classifyEnvironmentSkip(name: string, error: unknown): string | undefined {
  const adsErrors = extractGoogleAdsErrors(error);
  if (adsErrors.length === 0) return undefined;

  const hasNoEffectiveBilling = adsErrors.some(
    e =>
      (e.domain === "identity_verification_error" && (e.code === "NO_EFFECTIVE_BILLING" || e.code === "2")) ||
      /active billing linked/i.test(e.message)
  );
  if (hasNoEffectiveBilling && (name === "start_identity_verification" || name === "get_identity_verification")) {
    return "Customer has no active billing linked for identity verification.";
  }

   const hasMonthlyInvoicingRequirement = adsErrors.some(
    e =>
      (e.domain === "identity_verification_error" &&
        (e.code === "BILLING_NOT_ON_MONTHLY_INVOICING" || e.code === "19")) ||
      /monthly invoicing/i.test(e.message)
  );
  if (hasMonthlyInvoicingRequirement && (name === "start_identity_verification" || name === "get_identity_verification")) {
    return "Identity verification API requires a monthly-invoicing billing setup on this customer.";
  }

  const hasInvoiceMonthlyRestriction = adsErrors.some(
    e =>
      (e.domain === "invoice_error" &&
        (e.code === "BILLING_SETUP_NOT_ON_MONTHLY_INVOICING" || e.code === "6")) ||
      /not on monthly invoicing/i.test(e.message)
  );
  if (hasInvoiceMonthlyRestriction && name === "list_invoices") {
    return "Invoice listing is unavailable because billing setup is not on monthly invoicing.";
  }

  const hasEndpointNotEnabled = adsErrors.some(
    e =>
      e.domain === "authorization_error" &&
      (e.code === "ACTION_NOT_PERMITTED" || e.code === "7") &&
      /developer token not enabled/i.test(e.message)
  );
  if (
    hasEndpointNotEnabled &&
    (name === "list_audience_insights" || name === "list_reach_plan_locations" || name === "generate_reach_forecast")
  ) {
    return "Developer token is not enabled for this Google Ads endpoint.";
  }

  const hasUnsupportedExperimentType = adsErrors.some(
    e =>
      e.domain === "request_error" &&
      (e.code === "UNKNOWN" || e.code === "1") &&
      /not in this version/i.test(e.message)
  );
  if (name === "create_experiment" && hasUnsupportedExperimentType) {
    return "Experiment type is not supported for this account/token.";
  }

  const hasInternalExperimentError = adsErrors.some(e => e.domain === "internal_error");
  if (name === "create_experiment" && hasInternalExperimentError) {
    return "Google Ads returned an internal error for experiment creation on this account.";
  }

  const hasInternalApplyRecommendationError = adsErrors.some(
    e =>
      e.domain === "internal_error" &&
      (e.code === "INTERNAL_ERROR" || e.code === "1" || /internal error/i.test(e.message))
  );
  if (name === "apply_recommendation" && hasInternalApplyRecommendationError) {
    return "Google Ads returned an internal backend error while applying this recommendation.";
  }

  const hasAlreadyDismissedRecommendation = adsErrors.some(
    e =>
      (e.domain === "recommendation_error" &&
        (e.code === "RECOMMENDATION_ALREADY_DISMISSED" || e.code === "6")) ||
      /already been dismissed|already dismissed/i.test(e.message)
  );
  if (name === "dismiss_recommendation" && hasAlreadyDismissedRecommendation) {
    return "Recommendation is already dismissed on this account.";
  }

  const hasDismissResourceNotFound = adsErrors.some(
    e =>
      (e.domain === "request_error" &&
        (e.code === "RESOURCE_NOT_FOUND" || e.code === "6")) ||
      /resource not found/i.test(e.message)
  );
  if (name === "dismiss_recommendation" && hasDismissResourceNotFound) {
    return "Recommendation resource no longer exists (likely consumed or removed after apply).";
  }

  return undefined;
}

function formatNowForGoogleAds(): string {
  const d = new Date();
  const iso = d.toISOString().replace("T", " ").slice(0, 19);
  return `${iso}+00:00`;
}

function firstResourceName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const queue: any[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;

    if (typeof current.resource_name === "string") return current.resource_name;
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
    } else {
      for (const key of Object.keys(current)) queue.push((current as any)[key]);
    }
  }

  return undefined;
}

async function main() {
  const userId = (process.env.TEST_USER_ID || process.argv[2] || "").trim();
  if (!userId) {
    throw new Error("Set TEST_USER_ID in env or pass userId as first argument.");
  }

  // Keep mutation tests safe for tools that use runMutation().
  if (!process.env.GOOGLE_ADS_VALIDATE_ONLY) {
    process.env.GOOGLE_ADS_VALIDATE_ONLY = "true";
  }

  const results: ToolResult[] = [];
  const test = async (name: string, fn: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      await fn();
      const ms = Date.now() - started;
      results.push({ name, status: "pass", ms });
      console.log(`[PASS] ${name} (${ms}ms)`);
    } catch (error) {
      const ms = Date.now() - started;
      const skipReason = classifyEnvironmentSkip(name, error);
      if (skipReason) {
        results.push({ name, status: "skip", ms, details: skipReason });
        console.log(`[SKIP] ${name} (${ms}ms) -> ${skipReason}`);
        return;
      }

      const details = errToString(error);
      results.push({ name, status: "fail", ms, details });
      console.log(`[FAIL] ${name} (${ms}ms) -> ${details}`);
    }
  };
  const skip = (name: string, details: string) => {
    results.push({ name, status: "skip", ms: 0, details });
    console.log(`[SKIP] ${name} -> ${details}`);
  };

  console.log(`Using TEST_USER_ID=${userId}`);

  await test("new_coverage_tool_registration", async () => {
    if (!hasCoverageRegistrationInIndex()) {
      throw new Error("Coverage tool registration functions are not called from src/index.ts");
    }
    const registered = collectCoverageGeneratedToolNames();
    const expected = [
      ...new Set([
        ...MUTATE_COVERAGE_V23_EXPECTED_TOOL_NAMES,
        ...READ_PARITY_EXPECTED_TOOL_NAMES,
      ]),
    ];
    const missing = expected.filter(name => !registered.has(name));
    if (missing.length > 0) {
      throw new Error(`Missing registered tools: ${missing.join(", ")}`);
    }
    return {
      expected: expected.length,
      registered: registered.size,
    };
  });

  let customerId = (process.env.TEST_CUSTOMER_ID || "").replace(/-/g, "");
  const linkedAccounts = await listAccounts({ userId });
  if (!customerId) {
    let managerFallback = "";
    for (const resourceName of linkedAccounts) {
      const candidate = resourceName.split("/")[1]?.replace(/-/g, "") || "";
      if (!candidate) continue;

      try {
        const rows: any = await runQuery({
          customerId: candidate,
          userId,
          query: "SELECT customer.manager FROM customer LIMIT 1",
        });
        const isManager = Boolean(rows?.[0]?.customer?.manager);
        if (!isManager) {
          customerId = candidate;
          break;
        }
        if (!managerFallback) {
          managerFallback = candidate;
        }
      } catch {
        // Try next account.
      }
    }
    if (!customerId) {
      customerId = managerFallback || (linkedAccounts[0] || "").split("/")[1]?.replace(/-/g, "") || "";
    }
  }
  if (!customerId) {
    throw new Error("No linked customer ID found for this user.");
  }
  console.log(`Using customerId=${customerId}`);

  // Preload context IDs
  let campaignId = "0";
  let adGroupId = "0";
  let keywordId = "0";
  let adId = "0";
  let adGroupNegativeCriterionId = "0";
  let campaignNegativeCriterionId = "0";
  let recommendationResourceName = `customers/${customerId}/recommendations/0~0`;
  let billingSetupId = "0";
  let conversionActionId = "0";
  let merchantCenterId = (process.env.TEST_MERCHANT_ID || process.env.MERCHANT_CENTER_ID || "0").trim();
  let locationId = "2840";
  let batchJobResourceName = `customers/${customerId}/batchJobs/0`;
  let hasBatchOperations = false;
  let reachPlanAvailable = false;

  try {
    const campaigns = await runQuery({
      customerId,
      userId,
      query: "SELECT campaign.id FROM campaign LIMIT 1",
    });
    campaignId = String(campaigns?.[0]?.campaign?.id || campaignId);
  } catch {}

  try {
    const adGroups = await runQuery({
      customerId,
      userId,
      query: "SELECT ad_group.id, campaign.id FROM ad_group LIMIT 1",
    });
    adGroupId = String(adGroups?.[0]?.ad_group?.id || adGroupId);
    campaignId = String(adGroups?.[0]?.campaign?.id || campaignId);
  } catch {}

  try {
    const ads = await runQuery({
      customerId,
      userId,
      query: "SELECT ad_group.id, ad_group_ad.ad.id FROM ad_group_ad LIMIT 1",
    });
    adGroupId = String(ads?.[0]?.ad_group?.id || adGroupId);
    adId = String(ads?.[0]?.ad_group_ad?.ad?.id || adId);
  } catch {}

  try {
    const keywords = await runQuery({
      customerId,
      userId,
      query: "SELECT ad_group.id, ad_group_criterion.criterion_id FROM keyword_view LIMIT 1",
    });
    adGroupId = String(keywords?.[0]?.ad_group?.id || adGroupId);
    keywordId = String(keywords?.[0]?.ad_group_criterion?.criterion_id || keywordId);
  } catch {}

  try {
    const adGroupNegatives = await runQuery({
      customerId,
      userId,
      query:
        "SELECT ad_group.id, ad_group_criterion.criterion_id FROM ad_group_criterion WHERE ad_group_criterion.negative = true LIMIT 1",
    });
    adGroupId = String(adGroupNegatives?.[0]?.ad_group?.id || adGroupId);
    adGroupNegativeCriterionId = String(
      adGroupNegatives?.[0]?.ad_group_criterion?.criterion_id || adGroupNegativeCriterionId
    );
  } catch {}

  try {
    const campaignNegatives = await runQuery({
      customerId,
      userId,
      query:
        "SELECT campaign.id, campaign_criterion.criterion_id FROM campaign_criterion WHERE campaign_criterion.negative = true LIMIT 1",
    });
    campaignId = String(campaignNegatives?.[0]?.campaign?.id || campaignId);
    campaignNegativeCriterionId = String(
      campaignNegatives?.[0]?.campaign_criterion?.criterion_id || campaignNegativeCriterionId
    );
  } catch {}

  try {
    const recommendations = await listRecommendations({ customerId, userId, limit: 1 });
    recommendationResourceName = String(
      recommendations?.[0]?.recommendation?.resource_name || recommendationResourceName
    );
  } catch {}

  try {
    const billingSetups = await listBillingSetups({ customerId, userId });
    billingSetupId = String(billingSetups?.[0]?.billing_setup?.id || billingSetupId);
  } catch {}

  try {
    const conversionActions = await listConversionActions({ customerId, userId });
    conversionActionId = String(conversionActions?.[0]?.conversion_action?.id || conversionActionId);
  } catch {}

  try {
    const links = await listMerchantCenterLinks({ customerId, userId });
    merchantCenterId = String(
      (links as any)?.[0]?.product_link?.merchant_center?.merchant_center_id || merchantCenterId
    );
  } catch {}

  try {
    const locations: any = await listReachPlanLocations({ customerId, userId });
    reachPlanAvailable = true;
    locationId = String(
      locations?.plannable_locations?.[0]?.id ||
        locations?.[0]?.id ||
        locations?.[0]?.location_id ||
        locationId
    );
  } catch {}

  // Admin
  await test("get_user_status", () => getUserStatus({ userId }));

  // Core
  await test("list_accessible_accounts", () => listAccounts({ userId }));
  await test("run_gaql_query", () =>
    runQuery({
      customerId,
      userId,
      query: "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1",
    })
  );

  // Campaigns + ad groups
  if (campaignId !== "0") {
    await test("pause_campaign", () => pauseCampaign({ customerId, campaignId, userId }));
    await test("enable_campaign", () => enableCampaign({ customerId, campaignId, userId }));
    await test("remove_campaign", () => removeCampaign({ customerId, campaignId, userId }));
  } else {
    skip("pause_campaign", "No campaign discovered for this customer.");
    skip("enable_campaign", "No campaign discovered for this customer.");
    skip("remove_campaign", "No campaign discovered for this customer.");
  }

  if (adGroupId !== "0") {
    await test("pause_ad_group", () => pauseAdGroup({ customerId, adGroupId, userId }));
    await test("enable_ad_group", () => enableAdGroup({ customerId, adGroupId, userId }));
    await test("remove_ad_group", () => removeAdGroup({ customerId, adGroupId, userId }));
  } else {
    skip("pause_ad_group", "No ad group discovered for this customer.");
    skip("enable_ad_group", "No ad group discovered for this customer.");
    skip("remove_ad_group", "No ad group discovered for this customer.");
  }

  // Keywords + negatives
  if (adGroupId !== "0") {
    await test("add_keyword", () =>
      addKeyword({
        customerId,
        adGroupId,
        text: "mcp test keyword",
        matchType: "PHRASE",
        userId,
      })
    );
    if (keywordId !== "0") {
      await test("pause_keyword", () => pauseKeyword({ customerId, adGroupId, keywordId, userId }));
      await test("enable_keyword", () => enableKeyword({ customerId, adGroupId, keywordId, userId }));
      await test("remove_keyword", () => removeKeyword({ customerId, adGroupId, keywordId, userId }));
    } else {
      skip("pause_keyword", "No keyword discovered for this customer.");
      skip("enable_keyword", "No keyword discovered for this customer.");
      skip("remove_keyword", "No keyword discovered for this customer.");
    }

    await test("add_ad_group_negative_keyword", () =>
      addAdGroupNegativeKeyword({
        customerId,
        adGroupId,
        text: "mcp negative",
        matchType: "PHRASE",
        userId,
      })
    );
    if (adGroupNegativeCriterionId !== "0") {
      await test("remove_ad_group_negative_keyword", () =>
        removeAdGroupNegativeKeyword({
          customerId,
          adGroupId,
          criterionId: adGroupNegativeCriterionId,
          userId,
        })
      );
    } else {
      skip("remove_ad_group_negative_keyword", "No ad-group negative keyword discovered.");
    }
  } else {
    skip("add_keyword", "No ad group discovered for this customer.");
    skip("pause_keyword", "No ad group discovered for this customer.");
    skip("enable_keyword", "No ad group discovered for this customer.");
    skip("remove_keyword", "No ad group discovered for this customer.");
    skip("add_ad_group_negative_keyword", "No ad group discovered for this customer.");
    skip("remove_ad_group_negative_keyword", "No ad group discovered for this customer.");
  }

  if (campaignId !== "0") {
    await test("add_campaign_negative_keyword", () =>
      addCampaignNegativeKeyword({
        customerId,
        campaignId,
        text: "mcp campaign negative",
        matchType: "EXACT",
        userId,
      })
    );
    if (campaignNegativeCriterionId !== "0") {
      await test("remove_campaign_negative_keyword", () =>
        removeCampaignNegativeKeyword({
          customerId,
          campaignId,
          criterionId: campaignNegativeCriterionId,
          userId,
        })
      );
    } else {
      skip("remove_campaign_negative_keyword", "No campaign negative keyword discovered.");
    }
  } else {
    skip("add_campaign_negative_keyword", "No campaign discovered for this customer.");
    skip("remove_campaign_negative_keyword", "No campaign discovered for this customer.");
  }

  // Ads + assets
  if (adGroupId !== "0") {
    await test("create_responsive_search_ad", () =>
      createResponsiveSearchAd({
        customerId,
        adGroupId,
        headlines: [{ text: "MCP test headline 1" }, { text: "MCP test headline 2" }, { text: "MCP test headline 3" }],
        descriptions: [{ text: "MCP test description 1" }, { text: "MCP test description 2" }],
        finalUrls: ["https://example.com"],
        userId,
      })
    );
  } else {
    skip("create_responsive_search_ad", "No ad group discovered for this customer.");
  }

  if (adGroupId !== "0" && adId !== "0") {
    await test("pause_ad", () => pauseAd({ customerId, adGroupId, adId, userId }));
    await test("enable_ad", () => enableAd({ customerId, adGroupId, adId, userId }));
    await test("remove_ad", () => removeAd({ customerId, adGroupId, adId, userId }));
  } else {
    skip("pause_ad", "No ad discovered for this customer.");
    skip("enable_ad", "No ad discovered for this customer.");
    skip("remove_ad", "No ad discovered for this customer.");
  }
  await test("create_text_asset", () => createTextAsset({ customerId, text: "MCP test text asset", userId }));
  await test("create_image_asset", () =>
    createImageAsset({
      customerId,
      imageUrl: "https://www.gstatic.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
      name: "mcp-test-image-asset",
      userId,
    })
  );
  await test("list_assets", () => listAssets({ customerId, limit: 10, userId }));

  // Reporting + planning + policy
  await test("get_search_terms", () =>
    getSearchTerms({ customerId, limit: 10, dateRange: "LAST_30_DAYS", userId })
  );
  await test("get_change_history", () => getChangeHistory({ customerId, limit: 10, userId }));
  await test("generate_keyword_ideas", () =>
    generateKeywordIdeas({
      customerId,
      keywordTexts: ["google ads", "ppc management"],
      languageId: "1000",
      includeAdultKeywords: false,
      userId,
    })
  );
  await test("list_recommendations", () => listRecommendations({ customerId, limit: 10, userId }));
  if (!recommendationResourceName.endsWith("/0~0")) {
    await test("apply_recommendation", () =>
      applyRecommendation({ customerId, recommendationResourceName, userId })
    );
    await test("dismiss_recommendation", () =>
      dismissRecommendation({ customerId, recommendationResourceName, userId })
    );
  } else {
    skip("apply_recommendation", "No recommendation discovered for this customer.");
    skip("dismiss_recommendation", "No recommendation discovered for this customer.");
  }
  await test("list_policy_findings", () => listPolicyFindings({ customerId, limit: 10, userId }));

  // Shopping + verticals
  await test("list_shopping_performance", () =>
    listShoppingPerformance({ customerId, dateRange: "LAST_30_DAYS", limit: 10, userId })
  );
  await test("list_listing_groups", () =>
    listListingGroups({ customerId, ...(adGroupId !== "0" ? { adGroupId } : {}), userId })
  );
  await test("list_asset_group_listing_groups", () =>
    listAssetGroupListingGroups({ customerId, userId })
  );
  await test("list_hotel_performance", () =>
    listHotelPerformance({
      customerId,
      fields: ["segments.partner_hotel_id", "campaign.name"],
      limit: 10,
      userId,
    })
  );
  await test("list_audience_insights", () =>
    listAudienceInsights({
      customerId,
      customerInsightsGroup: `customers/${customerId}/customerInsightsGroups/0`,
      dimensions: ["AFFINITY_USER_INTEREST"],
      userId,
    })
  );

  // Audiences + conversions
  await test("create_user_list", () =>
    createUserList({
      customerId,
      name: `MCP Test User List ${Date.now()}`,
      description: "validate-only smoke test",
      membershipLifeSpan: 30,
      userId,
    })
  );
  await test("list_user_lists", () => listUserLists({ customerId, userId }));
  await test("create_conversion_action", () =>
    createConversionAction({
      customerId,
      name: `MCP Test Conversion ${Date.now()}`,
      type: "WEBPAGE",
      category: "LEAD",
      userId,
    })
  );
  await test("list_conversion_actions", () => listConversionActions({ customerId, userId }));
  if (conversionActionId !== "0") {
    await test("upload_click_conversion", () =>
      uploadClickConversion({
        customerId,
        conversionActionId,
        gclid: "test-gclid",
        conversionDateTime: formatNowForGoogleAds(),
        conversionValue: 1,
        currencyCode: "USD",
        userId,
      })
    );
  } else {
    skip("upload_click_conversion", "No conversion action discovered for this customer.");
  }

  // Billing + account administration
  await test("list_billing_setups", () => listBillingSetups({ customerId, userId }));
  await test("list_account_budgets", () => listAccountBudgets({ customerId, limit: 10, userId }));
  if (billingSetupId !== "0") {
    await test("list_invoices", () =>
      listInvoices({
        customerId,
        billingSetupId,
        issueYear: String(new Date().getUTCFullYear()),
        issueMonth: "JANUARY",
        userId,
      })
    );
  } else {
    skip("list_invoices", "No billing setup discovered for this customer.");
  }

  // Merchant linking + products
  await test("list_merchant_center_links", () => listMerchantCenterLinks({ customerId, userId }));
  const hasMerchantId = /^\d+$/.test(merchantCenterId) && merchantCenterId !== "0";
  if (hasMerchantId) {
    await test("link_merchant_center", () =>
      linkMerchantCenter({ customerId, merchantCenterId, userId })
    );
    await test("unlink_merchant_center", () =>
      unlinkMerchantCenter({ customerId, merchantCenterId, userId })
    );
    await test("list_products", () => listProducts({ merchantId: merchantCenterId, maxResults: 5, userId }));
    const offerId = `mcp-test-${Date.now()}`;
    const productId = `online:en:US:${offerId}`;
    await test("insert_product", () =>
      insertProduct({
        merchantId: merchantCenterId,
        offerId,
        title: "MCP Test Product",
        description: "MCP smoke test product",
        link: "https://example.com",
        imageLink: "https://www.gstatic.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
        contentLanguage: "en",
        targetCountry: "US",
        channel: "online",
        availability: "in stock",
        price: { value: "10.00", currency: "USD" },
        condition: "new",
        userId,
      })
    );
    await test("get_product", () => getProduct({ merchantId: merchantCenterId, productId, userId }));
    await test("delete_product", () => deleteProduct({ merchantId: merchantCenterId, productId, userId }));
  } else {
    skip("link_merchant_center", "Set TEST_MERCHANT_ID or MERCHANT_CENTER_ID to a valid Merchant Center ID.");
    skip("unlink_merchant_center", "Set TEST_MERCHANT_ID or MERCHANT_CENTER_ID to a valid Merchant Center ID.");
    skip("list_products", "Set TEST_MERCHANT_ID or MERCHANT_CENTER_ID to a valid Merchant Center ID.");
    skip("insert_product", "Set TEST_MERCHANT_ID or MERCHANT_CENTER_ID to a valid Merchant Center ID.");
    skip("get_product", "Set TEST_MERCHANT_ID or MERCHANT_CENTER_ID to a valid Merchant Center ID.");
    skip("delete_product", "Set TEST_MERCHANT_ID or MERCHANT_CENTER_ID to a valid Merchant Center ID.");
  }

  // Batch jobs
  await test("create_batch_job", async () => {
    const created = await createBatchJob({ customerId, userId });
    batchJobResourceName = firstResourceName(created) || batchJobResourceName;
  });
  await test("list_batch_jobs", () => listBatchJobs({ customerId, limit: 10, userId }));
  await test("add_batch_job_operations", async () => {
    const response: any = await addBatchJobOperations({
      customerId,
      batchJobResourceName,
      operations: [],
      userId,
    });
    hasBatchOperations = !response?.skipped;
    return response;
  });
  if (hasBatchOperations) {
    await test("run_batch_job", () => runBatchJob({ customerId, batchJobResourceName, userId }));
  } else {
    skip("run_batch_job", "No operations were added to the batch job.");
  }

  // Identity + special services
  await test("start_identity_verification", () => startIdentityVerification({ customerId, userId }));
  await test("get_identity_verification", () => getIdentityVerification({ customerId, userId }));
  await test("list_local_services_leads", () => listLocalServicesLeads({ customerId, limit: 10, userId }));

  // Experiments + reach
  await test("list_experiments", () => listExperiments({ customerId, limit: 10, userId }));
  await test("create_experiment", () =>
    createExperiment({
      customerId,
      name: `MCP Test Experiment ${Date.now()}`,
      suffix: "mcp",
      type: "SEARCH_CUSTOM",
      userId,
    })
  );
  await test("list_reach_plan_locations", async () => {
    const result: any = await listReachPlanLocations({ customerId, userId });
    reachPlanAvailable = true;
    locationId = String(
      result?.plannable_locations?.[0]?.id ||
        result?.[0]?.id ||
        result?.[0]?.location_id ||
        locationId
    );
    return result;
  });
  if (reachPlanAvailable) {
    await test("generate_reach_forecast", () =>
      generateReachForecast({
        customerId,
        locationId,
        currencyCode: "USD",
        budgetMicros: "10000000",
        userId,
      })
    );
  } else {
    skip("generate_reach_forecast", "Reach plan locations are unavailable for this token/account.");
  }

  const pass = results.filter(r => r.status === "pass");
  const fail = results.filter(r => r.status === "fail");
  const skipCount = results.filter(r => r.status === "skip");

  console.log("\n=== TOOL TEST SUMMARY ===");
  console.log(`Total: ${results.length}`);
  console.log(`Pass : ${pass.length}`);
  console.log(`Skip : ${skipCount.length}`);
  console.log(`Fail : ${fail.length}`);

  if (fail.length > 0) {
    console.log("\nFailed tools:");
    for (const f of fail) {
      console.log(`- ${f.name}: ${f.details}`);
    }
  }
}

main().catch(error => {
  console.error("Fatal test runner error:", errToString(error));
  process.exit(1);
});
