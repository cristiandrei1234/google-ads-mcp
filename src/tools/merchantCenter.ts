import { z } from "zod";
import { getContentService } from "../services/merchant-center/client";
import logger from "../observability/logger";
import config from "../config/env";

const MerchantIdSchema = z.object({
  merchantId: z.string().describe("The Merchant Center Account ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListProductsSchema = MerchantIdSchema.extend({
  maxResults: z.number().optional().describe("Number of products to list (default 10)"),
});

export async function listProducts(args: z.infer<typeof ListProductsSchema>) {
  const service = await getContentService(args.userId);
  const merchantId = args.merchantId || config.MERCHANT_CENTER_ID;

  if (!merchantId) {
    throw new Error("Merchant Center ID is required (either in args or env MERCHANT_CENTER_ID)");
  }

  logger.info(`Listing products for Merchant Center ${merchantId}`);
  
  try {
    const res = await service.products.list({
      merchantId: merchantId,
      maxResults: args.maxResults || 10,
    });
    return res.data.resources || [];
  } catch (error: any) {
    logger.error(`Failed to list products: ${error.message}`);
    throw error;
  }
}

export const GetProductSchema = MerchantIdSchema.extend({
  productId: z.string().describe("The ID of the product to retrieve"),
});

export async function getProduct(args: z.infer<typeof GetProductSchema>) {
  const service = await getContentService(args.userId);
  const merchantId = args.merchantId || config.MERCHANT_CENTER_ID;

  if (!merchantId) {
    throw new Error("Merchant Center ID is required");
  }

  try {
    const res = await service.products.get({
      merchantId: merchantId,
      productId: args.productId,
    });
    return res.data;
  } catch (error: any) {
    logger.error(`Failed to get product ${args.productId}: ${error.message}`);
    throw error;
  }
}

export const InsertProductSchema = MerchantIdSchema.extend({
  offerId: z.string().describe("Your unique product ID (SKU)"),
  title: z.string().describe("Product title"),
  description: z.string().describe("Product description"),
  link: z.string().describe("Product landing page URL"),
  imageLink: z.string().describe("Product image URL"),
  contentLanguage: z.string().default("en").describe("Two-letter ISO 639-1 language code"),
  targetCountry: z.string().default("US").describe("Two-letter ISO 3166-1 alpha-2 country code"),
  channel: z.enum(["online", "local"]).default("online").describe("Product channel"),
  availability: z.enum(["in stock", "out of stock", "preorder"]).default("in stock").describe("Availability status"),
  price: z.object({
    value: z.string().describe("Price value (e.g. '10.00')"),
    currency: z.string().describe("Currency code (e.g. 'USD')"),
  }).describe("Product price"),
  brand: z.string().optional().describe("Product brand"),
  condition: z.enum(["new", "refurbished", "used"]).default("new").describe("Product condition"),
});

export async function insertProduct(args: z.infer<typeof InsertProductSchema>) {
  const service = await getContentService(args.userId);
  const merchantId = args.merchantId || config.MERCHANT_CENTER_ID;

  if (!merchantId) {
    throw new Error("Merchant Center ID is required");
  }

  const product = {
    offerId: args.offerId,
    title: args.title,
    description: args.description,
    link: args.link,
    imageLink: args.imageLink,
    contentLanguage: args.contentLanguage,
    targetCountry: args.targetCountry,
    channel: args.channel,
    availability: args.availability,
    price: args.price,
    brand: args.brand,
    condition: args.condition,
  };

  logger.info(`Inserting product ${args.offerId} into Merchant Center ${merchantId}`);

  try {
    const res = await service.products.insert({
      merchantId: merchantId,
      requestBody: product,
    });
    return res.data;
  } catch (error: any) {
    logger.error(`Failed to insert product: ${error.message}`);
    throw error;
  }
}

export const DeleteProductSchema = MerchantIdSchema.extend({
  productId: z.string().describe("The REST ID of the product to delete (format: channel:contentLanguage:targetCountry:offerId)"),
});

export async function deleteProduct(args: z.infer<typeof DeleteProductSchema>) {
  const service = await getContentService(args.userId);
  const merchantId = args.merchantId || config.MERCHANT_CENTER_ID;

  if (!merchantId) {
    throw new Error("Merchant Center ID is required");
  }

  logger.info(`Deleting product ${args.productId} from Merchant Center ${merchantId}`);

  try {
    await service.products.delete({
      merchantId: merchantId,
      productId: args.productId,
    });
    return { success: true, productId: args.productId };
  } catch (error: any) {
    logger.error(`Failed to delete product: ${error.message}`);
    throw error;
  }
}
