import { describe, it, expect, vi } from "vitest";
import {
  isTransientError,
  isAuthError,
  withRetry,
  wrapCustomerWithResilience,
  RetryTimeoutError,
} from "./retry.js";

describe("isTransientError", () => {
  it("treats a RetryTimeoutError as transient", () => {
    expect(isTransientError(new RetryTimeoutError(10))).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError("nope")).toBe(false);
  });

  it("matches transient syscall codes but not others", () => {
    expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientError({ code: "ENOTFOUND" })).toBe(false);
  });

  it("matches transient gRPC numeric codes but not others", () => {
    expect(isTransientError({ code: 14 })).toBe(true); // UNAVAILABLE
    expect(isTransientError({ code: 3 })).toBe(false); // INVALID_ARGUMENT
  });

  it("matches transient HTTP status from status/httpStatus/response", () => {
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ httpStatus: 429 })).toBe(true);
    expect(isTransientError({ response: { status: 500 } })).toBe(true);
    expect(isTransientError({ status: 400 })).toBe(false);
  });

  it("matches transient message text", () => {
    expect(isTransientError({ message: "Service UNAVAILABLE, try later" })).toBe(true);
    expect(isTransientError({ message: "too many requests" })).toBe(true);
    expect(isTransientError({ message: "policy violation" })).toBe(false);
  });

  it("returns false for an empty error object", () => {
    expect(isTransientError({})).toBe(false);
  });
});

describe("isAuthError", () => {
  it("rejects non-objects", () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError("x")).toBe(false);
  });

  it("matches gRPC UNAUTHENTICATED, HTTP 401, and token messages", () => {
    expect(isAuthError({ code: 16 })).toBe(true);
    expect(isAuthError({ status: 401 })).toBe(true);
    expect(isAuthError({ response: { status: 401 } })).toBe(true);
    expect(isAuthError({ message: "invalid_grant" })).toBe(true);
    expect(isAuthError({ message: "Token has been expired or revoked." })).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isAuthError({ code: 14 })).toBe(false);
    expect(isAuthError({ status: 500 })).toBe(false);
    expect(isAuthError({ message: "policy violation" })).toBe(false);
    expect(isAuthError({})).toBe(false);
  });
});

describe("withRetry", () => {
  const noSleep = vi.fn(async () => {});
  const fixedRandom = () => 0.5;

  it("returns the result on first success without sleeping", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, { sleep: noSleep, random: fixedRandom })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("retries transient failures then succeeds, backing off between attempts", async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 14 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue("done");
    const result = await withRetry(fn, { sleep, random: fixedRandom, baseMs: 100, onRetry });
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // attempt 1: base 100 -> 50 + 0.5*50 = 75; attempt 2: 200 -> 100 + 0.5*100 = 150
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([75, 150]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("uses the default real sleep between retries when none is injected", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ code: 14 }).mockResolvedValue("ok");
    await expect(withRetry(fn, { baseMs: 1, random: () => 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("invalid argument");
    });
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow("invalid argument");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries and throws the last error", async () => {
    const fn = vi.fn(async () => {
      throw { code: 14, message: "UNAVAILABLE" };
    });
    await expect(withRetry(fn, { retries: 2, sleep: noSleep, random: fixedRandom })).rejects.toMatchObject({
      code: 14,
    });
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("caps the backoff at maxMs", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValueOnce({ code: 14 }).mockResolvedValue("ok");
    await withRetry(fn, { sleep, random: () => 1, baseMs: 10_000, maxMs: 1_000 });
    // exponential capped at 1000 -> 500 + 1*500 = 1000
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("times out a slow attempt and retries it (real timers, default scheduler)", async () => {
    // Attempt 1 never resolves -> the real 5ms timer fires a RetryTimeoutError
    // (transient) and we retry; attempt 2 resolves before its timer.
    let calls = 0;
    const fn = vi.fn(() => {
      calls += 1;
      return calls === 1 ? new Promise<string>(() => {}) : Promise.resolve("recovered");
    });
    const result = await withRetry(fn, { timeoutMs: 5, sleep: vi.fn(async () => {}), random: () => 0 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears the timer when the attempt succeeds within the timeout", async () => {
    const setTimer = vi.fn(() => 42 as unknown as ReturnType<typeof setTimeout>);
    const clearTimer = vi.fn();
    const result = await withRetry(() => Promise.resolve("fast"), {
      timeoutMs: 100,
      setTimer: setTimer as never,
      clearTimer,
    });
    expect(result).toBe("fast");
    expect(clearTimer).toHaveBeenCalledWith(42);
  });

  it("propagates a rejection while a timeout is armed (clearing the timer)", async () => {
    const setTimer = vi.fn(() => 7 as unknown as ReturnType<typeof setTimeout>);
    const clearTimer = vi.fn();
    await expect(
      withRetry(() => Promise.reject(new Error("boom")), {
        timeoutMs: 100,
        retries: 0,
        setTimer: setTimer as never,
        clearTimer,
        sleep: vi.fn(async () => {}),
      })
    ).rejects.toThrow("boom");
    expect(clearTimer).toHaveBeenCalledWith(7);
  });
});

describe("wrapCustomerWithResilience", () => {
  it("wraps query and mutateResources, leaving other props intact", async () => {
    const query = vi.fn(async (q: string) => `rows:${q}`);
    const mutateResources = vi.fn(async () => ({ ok: true }));
    const customer = { query, mutateResources, customerId: "123" };
    const wrapped = wrapCustomerWithResilience(customer, { sleep: vi.fn(async () => {}) });
    expect(wrapped).toBe(customer);
    expect(wrapped.query).not.toBe(query); // replaced with a resilient wrapper
    await expect(wrapped.query("SELECT 1")).resolves.toBe("rows:SELECT 1");
    await expect(wrapped.mutateResources()).resolves.toEqual({ ok: true });
    expect(customer.customerId).toBe("123");
  });

  it("leaves a customer without query/mutate methods untouched", () => {
    const stub = { __customer: { id: 1 } } as Record<string, unknown>;
    expect(wrapCustomerWithResilience(stub)).toEqual({ __customer: { id: 1 } });
  });

  it("retries a transient failure on the wrapped query", async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce({ code: 14 })
      .mockResolvedValue("ok");
    const customer = { query };
    const wrapped = wrapCustomerWithResilience(customer, { sleep: vi.fn(async () => {}), random: () => 0 });
    await expect(wrapped.query()).resolves.toBe("ok");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("fires onAuthError when the call fails with an auth error, then rethrows", async () => {
    const onAuthError = vi.fn();
    const query = vi.fn(async () => { throw { message: "invalid_grant" }; });
    const wrapped = wrapCustomerWithResilience({ query }, { onAuthError, sleep: vi.fn(async () => {}) });
    await expect(wrapped.query()).rejects.toMatchObject({ message: "invalid_grant" });
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it("does not fire onAuthError for a non-auth failure", async () => {
    const onAuthError = vi.fn();
    const query = vi.fn(async () => { throw new Error("bad request"); });
    const wrapped = wrapCustomerWithResilience({ query }, { onAuthError, sleep: vi.fn(async () => {}) });
    await expect(wrapped.query()).rejects.toThrow("bad request");
    expect(onAuthError).not.toHaveBeenCalled();
  });
});
