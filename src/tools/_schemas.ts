import { z } from "zod";

/**
 * Identity fields shared by every tool's input schema.
 *
 * `userId` is kept here only for transitional call-site typing — the registered
 * schema strips it (see createServer.ts) because the authenticated session is
 * authoritative and identity is never accepted from the client.
 */
export const BaseSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

/** {@link BaseSchema} plus a bounded `limit` for list-style tools. */
export const LimitedListSchema = BaseSchema.extend({
  limit: z.number().int().min(1).max(1000).default(100),
});

/** Split an array into consecutive sub-arrays of at most `size` items. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
