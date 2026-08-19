import { describe, it, expect, vi, beforeEach } from "vitest";

const { appendAuditLog, warn } = vi.hoisted(() => ({
  appendAuditLog: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../services/db.js", () => ({ appendAuditLog }));
vi.mock("./logger.js", () => ({ default: { warn } }));

import { buildAuditEntry, recordAuditEntry } from "./auditTrail.js";
import type { AuthContext } from "../auth/identityContext.js";

const identity: AuthContext = {
  userId: "u-1",
  orgId: "org-1",
  memberId: "m-1",
  role: "admin",
  requestId: "req-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildAuditEntry", () => {
  it("records who did what, on which account, with what outcome", () => {
    expect(buildAuditEntry(identity, "pause_campaign", "1234567890", "ok")).toEqual({
      organizationId: "org-1",
      memberId: "m-1",
      userId: "u-1",
      tool: "pause_campaign",
      customerId: "1234567890",
      outcome: "ok",
      errorKind: null,
    });
  });

  it("keeps the error kind on a failure", () => {
    const entry = buildAuditEntry(identity, "remove_ad", "1", "denied", "unconfirmed_destructive");
    expect(entry?.outcome).toBe("denied");
    expect(entry?.errorKind).toBe("unconfirmed_destructive");
  });

  it("normalises a missing customerId to null rather than dropping it", () => {
    expect(buildAuditEntry(identity, "list_accessible_accounts", undefined, "ok")?.customerId).toBeNull();
  });

  it("returns nothing in single-operator mode", () => {
    expect(buildAuditEntry(undefined, "pause_campaign", "1", "ok")).toBeNull();
  });

  it("returns nothing for an identity with no organization", () => {
    expect(buildAuditEntry({ ...identity, orgId: undefined }, "pause_campaign", "1", "ok")).toBeNull();
  });
});

describe("recordAuditEntry", () => {
  it("appends the entry unchanged", async () => {
    appendAuditLog.mockResolvedValue(undefined);
    const entry = buildAuditEntry(identity, "pause_campaign", "1", "ok");
    recordAuditEntry(entry!);
    await vi.waitFor(() => expect(appendAuditLog).toHaveBeenCalledWith(entry));
  });

  it("logs a failed write instead of failing the tool call", async () => {
    appendAuditLog.mockRejectedValue(new Error("db down"));
    recordAuditEntry(buildAuditEntry(identity, "pause_campaign", "1", "ok")!);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0]?.[1]).toBe("audit log write failed");
  });
});
