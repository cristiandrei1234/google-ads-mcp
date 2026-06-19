"use client";

import { API_URL } from "./auth-client";

/**
 * Thin client for the MCP server's admin/onboarding API. All requests are
 * credentialed (session cookie) so the server authorizes them as the signed-in
 * org admin.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface Connection {
  id: string;
  label: string;
  mccCustomerId: string;
  ownerMemberId: string;
  isAgencyRoot: boolean;
  status: string;
  createdAt: string;
}

export interface Member {
  id: string;
  userId: string;
  role: string;
  user: { email: string; name: string | null };
}

export type AccessLevel = "READ" | "WRITE" | "ADMIN";

export const listConnections = () =>
  request<{ connections: Connection[] }>("/admin/connections").then((r) => r.connections);

export const listMembers = () =>
  request<{ members: Member[] }>("/admin/members").then((r) => r.members);

export const listAccessibleAccounts = (connectionId: string) =>
  request<{ accounts: string[] }>(`/admin/accessible-accounts?connectionId=${encodeURIComponent(connectionId)}`).then(
    (r) => r.accounts
  );

export interface Grant {
  memberId: string;
  memberEmail: string;
  connectionId: string;
  connectionLabel: string;
  customerId: string;
  accessLevel: AccessLevel;
}

export const listGrants = () => request<{ grants: Grant[] }>("/admin/grants").then((r) => r.grants);

export const addGrant = (body: {
  memberId: string;
  connectionId: string;
  customerId: string;
  accessLevel: AccessLevel;
}) => request<{ grant: unknown }>("/admin/grants", { method: "POST", body: JSON.stringify(body) });

export const removeGrant = (body: { memberId: string; connectionId: string; customerId: string }) =>
  request<{ removed: number }>("/admin/grants", { method: "DELETE", body: JSON.stringify(body) });

/** Kick off the Google Ads OAuth connect (top-level navigation carries cookies). */
export const startConnect = () => {
  window.location.href = `${API_URL}/connect/google-ads`;
};
