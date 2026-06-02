import { describe, it, expect, beforeEach, vi } from "vitest";

const { getUserStatusData, findMany } = vi.hoisted(() => ({
  getUserStatusData: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../services/db.js", () => ({
  default: { user: { findMany } },
  getUserStatusData,
}));

import { getUserStatus, listUsers, GetUserStatusToolSchema } from "./admin.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserStatus", () => {
  it("returns the status when the user exists", async () => {
    getUserStatusData.mockResolvedValue({ memberships: [], grants: [] });
    const res = await getUserStatus({ targetUserId: "u-1" });
    expect(getUserStatusData).toHaveBeenCalledWith("u-1");
    expect(res).toEqual({ memberships: [], grants: [] });
  });

  it("throws when the user is not found", async () => {
    getUserStatusData.mockResolvedValue(null);
    await expect(getUserStatus({ targetUserId: "missing" })).rejects.toThrow(
      "User missing not found."
    );
  });
});

describe("listUsers", () => {
  it("selects id/email/name for all users", async () => {
    findMany.mockResolvedValue([{ id: "1", email: "a@b.c", name: "A" }]);
    const res = await listUsers();
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, email: true, name: true },
    });
    expect(res).toEqual([{ id: "1", email: "a@b.c", name: "A" }]);
  });
});

describe("GetUserStatusToolSchema", () => {
  it("validates a targetUserId", () => {
    expect(GetUserStatusToolSchema.parse({ targetUserId: "x" })).toEqual({ targetUserId: "x" });
    expect(() => GetUserStatusToolSchema.parse({})).toThrow();
  });
});
