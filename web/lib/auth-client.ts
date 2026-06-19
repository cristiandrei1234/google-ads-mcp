"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

/**
 * Better Auth client pointing at the MCP server. Cross-origin requests carry
 * the session cookie (the server's CORS allows this web origin with
 * credentials), so the same session authorizes the admin API in lib/api.ts.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3939";

export const authClient = createAuthClient({
  baseURL: `${API_URL}/api/auth`,
  plugins: [organizationClient()],
});

export const { useSession, signIn, signUp, signOut, organization } = authClient;
