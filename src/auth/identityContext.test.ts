import { describe, it, expect } from "vitest";
import { runWithIdentity, getIdentity, type AuthContext } from "./identityContext.js";

const ctx: AuthContext = {
  userId: "u1",
  orgId: "o1",
  memberId: "m1",
  role: "admin",
  requestId: "req-1",
};

describe("identityContext", () => {
  it("returns undefined when there is no ambient identity", () => {
    expect(getIdentity()).toBeUndefined();
  });

  it("exposes the ambient identity inside runWithIdentity", () => {
    const seen = runWithIdentity(ctx, () => getIdentity());
    expect(seen).toEqual(ctx);
  });

  it("returns the value produced by fn", () => {
    const result = runWithIdentity(ctx, () => 42);
    expect(result).toBe(42);
  });

  it("clears the identity once the callback returns", () => {
    runWithIdentity(ctx, () => getIdentity());
    expect(getIdentity()).toBeUndefined();
  });

  it("propagates identity across async continuations", async () => {
    const seen = await runWithIdentity(ctx, async () => {
      await Promise.resolve();
      return getIdentity();
    });
    expect(seen).toEqual(ctx);
  });

  it("supports nested contexts and restores the outer one", () => {
    const inner: AuthContext = { ...ctx, userId: "u2", orgId: null, memberId: null, role: null };
    runWithIdentity(ctx, () => {
      expect(getIdentity()?.userId).toBe("u1");
      runWithIdentity(inner, () => {
        expect(getIdentity()?.userId).toBe("u2");
      });
      expect(getIdentity()?.userId).toBe("u1");
    });
  });

  it("accepts a context without requestId", () => {
    const minimal: AuthContext = { userId: "u3", orgId: null, memberId: null, role: null };
    const seen = runWithIdentity(minimal, () => getIdentity());
    expect(seen).toEqual(minimal);
    expect(seen?.requestId).toBeUndefined();
  });
});
