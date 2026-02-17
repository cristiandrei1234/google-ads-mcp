import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";

const ListLocalServicesLeadsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  limit: z.number().default(50),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListLocalServicesLeadsToolSchema = ListLocalServicesLeadsSchema;
export async function listLocalServicesLeads(args: z.infer<typeof ListLocalServicesLeadsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const query = `
    SELECT
      local_services_lead.id,
      local_services_lead.category_id,
      local_services_lead.service_id,
      local_services_lead.contact_details,
      local_services_lead.lead_type,
      local_services_lead.lead_status,
      local_services_lead.creation_date_time,
      local_services_lead.locale,
      local_services_lead.lead_charged,
      local_services_lead.credit_details.credit_state,
      local_services_lead.credit_details.credit_state_last_update_date_time,
      local_services_lead.lead_feedback_submitted
    FROM local_services_lead
    ORDER BY local_services_lead.creation_date_time DESC
    LIMIT ${args.limit}
  `;
  
  return customer.query(query);
}
