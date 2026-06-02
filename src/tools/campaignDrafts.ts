import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { asTool } from "./_runtime.js";
import { BaseSchema } from "./_schemas.js";
import { normalizeCustomerId, extractResourceId, normalizeNumericId, toResourceName } from "../services/google-ads/resourceNames.js";





function toCampaignResourceName(customerId: string, campaignIdOrResourceName: string): string {
  return toResourceName(customerId, campaignIdOrResourceName, "campaigns");
}

function toCampaignDraftResourceName(customerId: string, draftIdOrResourceName: string): string {
  return toResourceName(customerId, draftIdOrResourceName, "campaignDrafts");
}

function resolveValidateOnlyFlag(override?: boolean): boolean {
  if (override != null) {
    return override;
  }
  return ["1", "true", "yes"].includes((process.env.GOOGLE_ADS_VALIDATE_ONLY || "").toLowerCase());
}

const ListCampaignDraftsSchema = BaseSchema.extend({
  baseCampaignId: z.string().optional().describe("Optional base campaign ID/resource name filter"),
  limit: z.number().int().min(1).max(1000).default(100),
});

async function listCampaignDrafts(args: z.infer<typeof ListCampaignDraftsSchema>) {
  const filters: string[] = [];
  if (args.baseCampaignId) {
    filters.push(`campaign_draft.base_campaign = '${toCampaignResourceName(args.customerId, args.baseCampaignId)}'`);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  return runQuery({
    customerId: args.customerId,
    userId: args.userId,
    query: `SELECT
      campaign_draft.resource_name,
      campaign_draft.draft_id,
      campaign_draft.base_campaign,
      campaign_draft.name,
      campaign_draft.draft_campaign,
      campaign_draft.status,
      campaign_draft.has_experiment_running,
      campaign_draft.long_running_operation
    FROM campaign_draft
    ${where}
    ORDER BY campaign_draft.draft_id DESC
    LIMIT ${args.limit}`,
  });
}

const CreateCampaignDraftSchema = BaseSchema.extend({
  baseCampaignId: z.string().describe("Base campaign ID/resource name"),
  name: z.string().min(1).describe("Draft name"),
});

async function createCampaignDraft(args: z.infer<typeof CreateCampaignDraftSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      campaign_draft_operation: {
        create: {
          base_campaign: toCampaignResourceName(args.customerId, args.baseCampaignId),
          name: args.name,
        },
      },
    },
  ]);
}

const UpdateCampaignDraftSchema = BaseSchema.extend({
  draftId: z.string().describe("Draft ID/resource name"),
  name: z.string().min(1).optional(),
  status: z.enum(["PROPOSED", "PROMOTING", "PROMOTED", "REMOVED"]).optional(),
});

async function updateCampaignDraft(args: z.infer<typeof UpdateCampaignDraftSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const update: Record<string, unknown> = {
    resource_name: toCampaignDraftResourceName(args.customerId, args.draftId),
  };
  const paths: string[] = [];

  if (args.name) {
    update.name = args.name;
    paths.push("name");
  }

  if (args.status) {
    update.status = args.status;
    paths.push("status");
  }

  if (paths.length === 0) {
    throw new Error("At least one field is required for update_campaign_draft.");
  }

  return runMutation(customer, [
    {
      campaign_draft_operation: {
        update,
        update_mask: { paths },
      },
    },
  ]);
}

const RemoveCampaignDraftSchema = BaseSchema.extend({
  draftId: z.string().describe("Draft ID/resource name"),
});

async function removeCampaignDraft(args: z.infer<typeof RemoveCampaignDraftSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  return runMutation(customer, [
    {
      campaign_draft_operation: {
        remove: toCampaignDraftResourceName(args.customerId, args.draftId),
      },
    },
  ]);
}

const PromoteCampaignDraftSchema = BaseSchema.extend({
  draftId: z.string().describe("Draft ID/resource name"),
  validateOnly: z.boolean().optional().describe("Validate only without applying"),
  waitForCompletion: z.boolean().default(false),
});

async function promoteCampaignDraft(args: z.infer<typeof PromoteCampaignDraftSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const service = (customer as any).loadService("CampaignDraftServiceClient");
  const resourceName = toCampaignDraftResourceName(args.customerId, args.draftId);
  const validateOnly = resolveValidateOnlyFlag(args.validateOnly);

  const [operation, rawOperation] = await service.promoteCampaignDraft(
    {
      campaign_draft: resourceName,
      validate_only: validateOnly,
    },
    {
      otherArgs: {
        headers: (customer as any).callHeaders,
      },
    }
  );

  let completion: unknown;
  if (args.waitForCompletion && operation?.promise) {
    completion = await operation.promise();
  }

  return {
    campaignDraftResourceName: resourceName,
    validateOnly,
    operationName: rawOperation?.name,
    operation: rawOperation,
    completion,
  };
}

const ListCampaignDraftAsyncErrorsSchema = BaseSchema.extend({
  draftId: z.string().describe("Draft ID/resource name"),
  pageSize: z.number().int().min(1).max(1000).default(100),
  pageToken: z.string().optional(),
});

async function listCampaignDraftAsyncErrors(args: z.infer<typeof ListCampaignDraftAsyncErrorsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const service = (customer as any).loadService("CampaignDraftServiceClient");
  const resourceName = toCampaignDraftResourceName(args.customerId, args.draftId);

  const [statuses, request, response] = await service.listCampaignDraftAsyncErrors(
    {
      resource_name: resourceName,
      page_size: args.pageSize,
      page_token: args.pageToken,
    },
    {
      otherArgs: {
        headers: (customer as any).callHeaders,
      },
    }
  );

  return {
    campaignDraftResourceName: resourceName,
    statuses,
    request,
    nextPageToken: response?.next_page_token,
    response,
  };
}


export function registerCampaignDraftTools(server: McpServer) {
  server.registerTool(
    "list_campaign_drafts",
    { description: "List campaign drafts.", inputSchema: ListCampaignDraftsSchema.shape },
    args => asTool(listCampaignDrafts, args)
  );
  server.registerTool(
    "create_campaign_draft",
    { description: "Create a campaign draft from a base campaign.", inputSchema: CreateCampaignDraftSchema.shape },
    args => asTool(createCampaignDraft, args)
  );
  server.registerTool(
    "update_campaign_draft",
    { description: "Update campaign draft metadata/status.", inputSchema: UpdateCampaignDraftSchema.shape },
    args => asTool(updateCampaignDraft, args)
  );
  server.registerTool(
    "remove_campaign_draft",
    { description: "Remove a campaign draft.", inputSchema: RemoveCampaignDraftSchema.shape },
    args => asTool(removeCampaignDraft, args)
  );
  server.registerTool(
    "promote_campaign_draft",
    { description: "Promote a campaign draft to a full campaign.", inputSchema: PromoteCampaignDraftSchema.shape },
    args => asTool(promoteCampaignDraft, args)
  );
  server.registerTool(
    "list_campaign_draft_async_errors",
    {
      description: "List asynchronous errors from campaign draft promotion.",
      inputSchema: ListCampaignDraftAsyncErrorsSchema.shape,
    },
    args => asTool(listCampaignDraftAsyncErrors, args)
  );
}
