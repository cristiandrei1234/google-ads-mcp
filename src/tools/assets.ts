import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";
import axios from "axios";

// --- Text Assets ---

const CreateTextAssetSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  text: z.string().describe("The content of the text asset"),
  name: z.string().optional().describe("Optional name for the asset"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const CreateTextAssetToolSchema = CreateTextAssetSchema;
export async function createTextAsset(args: z.infer<typeof CreateTextAssetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const operation = {
    asset_operation: {
      create: {
        type: "TEXT",
        text_asset: {
          text: args.text
        },
        name: args.name,
      }
    }
  };

  return runMutation(customer, [operation]);
}

// --- Image Assets ---

const CreateImageAssetSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  imageUrl: z.string().describe("The URL of the image to upload"),
  name: z.string().optional().describe("Optional name for the asset"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const CreateImageAssetToolSchema = CreateImageAssetSchema;
export async function createImageAsset(args: z.infer<typeof CreateImageAssetSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  try {
    // 1. Fetch the image
    const response = await axios.get(args.imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const base64Image = buffer.toString('base64');
    
    // 2. Upload asset
    const operation = {
      asset_operation: {
        create: {
          type: "IMAGE",
          name: args.name,
          image_asset: {
            data: base64Image,
          }
        }
      }
    };
    
    return runMutation(customer, [operation]);
  } catch (error: any) {
    logger.error(`Failed to create image asset from URL: ${error.message}`);
    throw error;
  }
}

// --- List Assets ---

const ListAssetsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  types: z.array(z.string()).optional().describe("Filter by asset types (e.g., TEXT, IMAGE)"),
  limit: z.number().default(50).describe("Limit results"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListAssetsToolSchema = ListAssetsSchema;
export async function listAssets(args: z.infer<typeof ListAssetsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  let query = `
    SELECT
      asset.id,
      asset.name,
      asset.type,
      asset.text_asset.text,
      asset.image_asset.full_size.url
    FROM asset
  `;
  
  if (args.types && args.types.length > 0) {
    const types = args.types.join("','");
    query += ` WHERE asset.type IN ('${types}')`;
  }
  
  query += ` ORDER BY asset.id DESC LIMIT ${args.limit}`;
  
  return customer.query(query);
}
