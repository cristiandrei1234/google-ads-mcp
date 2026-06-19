import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signConnectState, verifyConnectState } from "./connectState.js";

const SECRET = "test-secret-at-least-32-chars-long-xxxx";

describe("connectState", () => {
  it("round-trips a signed state", () => {
    const token = signConnectState({ memberId: "m1", orgId: "o1" }, SECRET, { now: 1_000, nonce: "n" });
    const state = verifyConnectState(token, SECRET, 1_500);
    expect(state).toMatchObject({ memberId: "m1", orgId: "o1", nonce: "n" });
    expect(state?.exp).toBe(1_000 + 10 * 60_000);
  });

  it("generates a random nonce by default and still verifies", () => {
    const token = signConnectState({ memberId: "m", orgId: "o" }, SECRET);
    const state = verifyConnectState(token, SECRET);
    expect(state?.memberId).toBe("m");
    expect(typeof state?.nonce).toBe("string");
  });

  it("rejects a tampered payload", () => {
    const token = signConnectState({ memberId: "m1", orgId: "o1" }, SECRET, { now: 0, nonce: "n" });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ memberId: "attacker", orgId: "o1", nonce: "n", exp: 9e15 }))
      .toString("base64url");
    expect(verifyConnectState(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects a wrong secret", () => {
    const token = signConnectState({ memberId: "m", orgId: "o" }, SECRET);
    expect(verifyConnectState(token, "other-secret")).toBeNull();
  });

  it("rejects a signature of a different length", () => {
    const token = signConnectState({ memberId: "m", orgId: "o" }, SECRET);
    expect(verifyConnectState(`${token.split(".")[0]}.short`, SECRET)).toBeNull();
  });

  it("rejects a malformed token (wrong part count)", () => {
    expect(verifyConnectState("no-dot", SECRET)).toBeNull();
    expect(verifyConnectState("a.b.c", SECRET)).toBeNull();
  });

  it("rejects a body that is not valid JSON (signature still matches)", () => {
    const body = Buffer.from("not-json").toString("base64url");
    const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyConnectState(`${body}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signConnectState({ memberId: "m", orgId: "o" }, SECRET, { now: 0, ttlMs: 100, nonce: "n" });
    expect(verifyConnectState(token, SECRET, 1_000)).toBeNull();
  });
});
