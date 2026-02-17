import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

const DismissPolicyFindingSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  resourceName: z.string().describe("The resource name of the policy finding (e.g., ad group ad)"),
  userId: z.string().optional().describe("SaaS User ID"),
});

// Note: Dismissing policy findings is usually done via an exemption request on the Ad or Asset.
// This is a simplified wrapper for common policy exemption workflows.
// However, the API typically requires sending an exemption list during the mutate of the ad itself.
// A standalone tool to "dismiss" might need to fetch the ad, add the exemption, and update it.
// This is complex.

// Instead, let's provide a reporting tool for Policy Diagnostics first.

const ListPolicyFindingsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  limit: z.number().default(50),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListPolicyFindingsToolSchema = ListPolicyFindingsSchema;
export async function listPolicyFindings(args: z.infer<typeof ListPolicyFindingsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  // We can query ad_group_ad_policy_summary or asset_policy_summary
  // Correcting fields
  const query = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.policy_summary.review_status,
      ad_group_ad.policy_summary.approval_status,
      ad_group_ad.policy_summary.policy_topic_entries
    FROM ad_group_ad
    WHERE ad_group_ad.policy_summary.approval_status != 'APPROVED'
    LIMIT ${args.limit}
  `;
  
  return customer.query(query);
}
