import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";

const LinkMerchantCenterSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  merchantCenterId: z.string().describe("The Merchant Center Account ID to link"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const LinkMerchantCenterToolSchema = LinkMerchantCenterSchema;
export async function linkMerchantCenter(args: z.infer<typeof LinkMerchantCenterSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const merchantCenterId = args.merchantCenterId.replace(/-/g, "").trim();
  if (!/^\d+$/.test(merchantCenterId)) {
    throw new Error(`Invalid merchantCenterId '${args.merchantCenterId}'. Expected numeric ID.`);
  }

  try {
    const result = await customer.productLinks.createProductLink({
      customer_id: args.customerId,
      product_link: {
        merchant_center: {
          merchant_center_id: Number(merchantCenterId),
        },
      },
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to link Merchant Center: ${error.message}`);
    throw error;
  }
}

const ListMerchantCenterLinksSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListMerchantCenterLinksToolSchema = ListMerchantCenterLinksSchema;
export async function listMerchantCenterLinks(args: z.infer<typeof ListMerchantCenterLinksSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const query = `
    SELECT 
      product_link.resource_name,
      product_link.product_link_id,
      product_link.type,
      product_link.merchant_center.merchant_center_id
    FROM product_link
    WHERE product_link.type = 'MERCHANT_CENTER'
  `;
  
  const result = await customer.query(query);
  return result;
}

const UnlinkMerchantCenterSchema = LinkMerchantCenterSchema;

export const UnlinkMerchantCenterToolSchema = UnlinkMerchantCenterSchema;
export async function unlinkMerchantCenter(args: z.infer<typeof UnlinkMerchantCenterSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const merchantCenterId = args.merchantCenterId.replace(/-/g, "").trim();
  if (!/^\d+$/.test(merchantCenterId)) {
    throw new Error(`Invalid merchantCenterId '${args.merchantCenterId}'. Expected numeric ID.`);
  }

  const links = await customer.query(`
    SELECT
      product_link.resource_name
    FROM product_link
    WHERE product_link.type = 'MERCHANT_CENTER'
      AND product_link.merchant_center.merchant_center_id = ${merchantCenterId}
    LIMIT 1
  `);

  const resourceName = links?.[0]?.product_link?.resource_name;
  if (!resourceName) {
    throw new Error(
      `No Merchant Center link found for merchantCenterId=${merchantCenterId} on customer ${args.customerId}.`
    );
  }

  const validateOnly = ["1", "true", "yes"].includes(
    (process.env.GOOGLE_ADS_VALIDATE_ONLY || "").toLowerCase()
  );

  try {
    const result = await customer.productLinks.removeProductLink({
      customer_id: args.customerId,
      resource_name: resourceName,
      validate_only: validateOnly,
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to unlink Merchant Center: ${error.message}`);
    throw error;
  }
}
