import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The authenticated caller, resolved from a Better Auth session/bearer token by
 * the HTTP layer and made available to tool handlers without threading it
 * through arguments. This is what replaces the untrusted `userId` argument.
 */
export interface AuthContext {
  userId: string;
  orgId: string | null;
  memberId: string | null;
  role: string | null;
  /** Correlation id for the originating HTTP request (for logs/tracing). */
  requestId?: string;
}

const storage = new AsyncLocalStorage<AuthContext>();

/** Run `fn` (and its async continuations) with `ctx` as the ambient identity. */
export function runWithIdentity<T>(ctx: AuthContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The ambient identity for the current async context, if any. */
export function getIdentity(): AuthContext | undefined {
  return storage.getStore();
}
