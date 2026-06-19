import { describe, it, expect, vi } from "vitest";
import { SessionStore } from "./sessionStore.js";

function fakeTransport(sessionId?: string) {
  return { sessionId, close: vi.fn(async () => {}) };
}

describe("SessionStore", () => {
  it("adds, counts, and resolves owned sessions", () => {
    let clock = 1000;
    const store = new SessionStore(() => clock);
    const t = fakeTransport("s1");
    store.add("s1", t, "user-a");
    expect(store.size).toBe(1);
    expect(store.getOwned("s1", "user-a")?.transport).toBe(t);
  });

  it("treats unknown id, missing id, and wrong owner as not found", () => {
    const store = new SessionStore(() => 0);
    store.add("s1", fakeTransport(), "user-a");
    expect(store.getOwned(undefined, "user-a")).toBeNull();
    expect(store.getOwned("nope", "user-a")).toBeNull();
    expect(store.getOwned("s1", "user-b")).toBeNull();
  });

  it("touch refreshes lastSeenAt for an existing session and no-ops otherwise", () => {
    let clock = 100;
    const store = new SessionStore(() => clock);
    store.add("s1", fakeTransport(), "u");
    clock = 500;
    store.touch("s1");
    expect(store.getOwned("s1", "u")?.lastSeenAt).toBe(500);
    store.touch("missing"); // must not throw
  });

  it("delete removes a session", () => {
    const store = new SessionStore(() => 0);
    store.add("s1", fakeTransport(), "u");
    store.delete("s1");
    expect(store.size).toBe(0);
  });

  it("sweepExpired evicts idle sessions, keeps fresh ones, and closes transports", async () => {
    let clock = 0;
    const store = new SessionStore(() => clock);
    const stale = fakeTransport("old");
    const fresh = fakeTransport("new");
    store.add("old", stale, "u");
    clock = 10_000;
    store.add("new", fresh, "u"); // lastSeenAt = 10_000
    clock = 11_000; // ttl 5000 -> cutoff 6000; old(0)<=6000 evict, new(10000)>6000 keep
    const evicted = await store.sweepExpired(5_000);
    expect(evicted).toBe(1);
    expect(store.size).toBe(1);
    expect(stale.close).toHaveBeenCalled();
    expect(fresh.close).not.toHaveBeenCalled();
  });

  it("sweepExpired still drops a session whose transport.close throws", async () => {
    const store = new SessionStore(() => 0);
    const bad = { sessionId: "x", close: vi.fn(async () => { throw new Error("boom"); }) };
    store.add("x", bad, "u");
    const evicted = await store.sweepExpired(-1); // cutoff in the future -> everything stale
    expect(evicted).toBe(1);
    expect(store.size).toBe(0);
  });

  it("closeForUser closes only that user's sessions", async () => {
    const store = new SessionStore(() => 0);
    const a1 = fakeTransport("a1");
    const a2 = fakeTransport("a2");
    const b1 = fakeTransport("b1");
    store.add("a1", a1, "user-a");
    store.add("a2", a2, "user-a");
    store.add("b1", b1, "user-b");
    const closed = await store.closeForUser("user-a");
    expect(closed).toBe(2);
    expect(store.size).toBe(1);
    expect(a1.close).toHaveBeenCalled();
    expect(a2.close).toHaveBeenCalled();
    expect(b1.close).not.toHaveBeenCalled();
    expect(store.getOwned("b1", "user-b")).not.toBeNull();
  });

  it("closeAll closes and clears every session (tolerating close errors)", async () => {
    const store = new SessionStore(() => 0);
    const good = fakeTransport("a");
    const bad = { sessionId: "b", close: vi.fn(() => { throw new Error("sync boom"); }) };
    store.add("a", good, "u");
    store.add("b", bad, "u");
    await store.closeAll();
    expect(store.size).toBe(0);
    expect(good.close).toHaveBeenCalled();
    expect(bad.close).toHaveBeenCalled();
  });

  it("defaults to Date.now when no clock is injected", () => {
    const store = new SessionStore();
    store.add("s", fakeTransport(), "u");
    expect(store.getOwned("s", "u")?.lastSeenAt).toBeTypeOf("number");
  });
});
