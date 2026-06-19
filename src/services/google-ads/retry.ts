/**
 * Resilience helpers for outbound Google Ads API calls: per-attempt timeout and
 * exponential backoff with jitter on *transient* failures only.
 *
 * Business errors (policy violations, invalid arguments, missing grants) are
 * NOT retried — retrying them just wastes quota and delays the real error. Only
 * transient transport/server conditions (429/5xx, gRPC UNAVAILABLE/INTERNAL/…,
 * connection resets, timeouts) are retried.
 */

export class RetryTimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = "RetryTimeoutError";
  }
}

const TRANSIENT_SYSCALL_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
  "ENETUNREACH",
]);
const TRANSIENT_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);
// gRPC status codes: DEADLINE_EXCEEDED(4), RESOURCE_EXHAUSTED(8), INTERNAL(13), UNAVAILABLE(14).
const TRANSIENT_GRPC_CODES = new Set([4, 8, 13, 14]);
const TRANSIENT_MESSAGE =
  /\b(UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|INTERNAL|too many requests|rate[ _]?limit|RATE_EXCEEDED)\b/i;

/** Classify an error as a transient (retryable) transport/server condition. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof RetryTimeoutError) return true;
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: unknown;
    status?: unknown;
    httpStatus?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };
  if (typeof e.code === "string" && TRANSIENT_SYSCALL_CODES.has(e.code)) return true;
  if (typeof e.code === "number" && TRANSIENT_GRPC_CODES.has(e.code)) return true;
  const status = e.status ?? e.httpStatus ?? e.response?.status;
  if (typeof status === "number" && TRANSIENT_HTTP_STATUS.has(status)) return true;
  if (typeof e.message === "string" && TRANSIENT_MESSAGE.test(e.message)) return true;
  return false;
}

export interface RetryConfig {
  /** Number of retries after the first attempt (total attempts = retries + 1). */
  retries?: number;
  /** Base backoff in ms (grows exponentially per attempt). */
  baseMs?: number;
  /** Backoff ceiling in ms. */
  maxMs?: number;
  /** Per-attempt timeout in ms; 0/undefined disables the timeout. */
  timeoutMs?: number;
  /** Override transient classification (tests). */
  isTransient?: (error: unknown) => boolean;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable timer primitives (tests). */
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Injectable randomness for jitter (tests). */
  random?: () => number;
  /** Observability hook fired before each backoff sleep. */
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with "equal jitter": half fixed, half random. */
function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  setTimer: NonNullable<RetryConfig["setTimer"]>,
  clearTimer: NonNullable<RetryConfig["clearTimer"]>
): Promise<T> {
  if (!ms) return fn();
  return new Promise<T>((resolve, reject) => {
    const handle = setTimer(() => reject(new RetryTimeoutError(ms)), ms);
    fn().then(
      (value) => {
        clearTimer(handle);
        resolve(value);
      },
      (error) => {
        clearTimer(handle);
        reject(error);
      }
    );
  });
}

/**
 * Run `fn`, retrying transient failures with exponential backoff. Each attempt
 * is bounded by `timeoutMs`. Non-transient errors (and the final attempt) throw.
 */
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig = {}): Promise<T> {
  const retries = config.retries ?? 3;
  const baseMs = config.baseMs ?? 500;
  const maxMs = config.maxMs ?? 8_000;
  const timeoutMs = config.timeoutMs ?? 0;
  const isTransient = config.isTransient ?? isTransientError;
  const sleep = config.sleep ?? defaultSleep;
  const random = config.random ?? Math.random;
  const setTimer = config.setTimer ?? setTimeout;
  const clearTimer = config.clearTimer ?? clearTimeout;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await withTimeout(fn, timeoutMs, setTimer, clearTimer);
    } catch (error) {
      if (attempt > retries || !isTransient(error)) {
        throw error;
      }
      const delayMs = backoffDelay(attempt, baseMs, maxMs, random);
      config.onRetry?.({ attempt, error, delayMs });
      await sleep(delayMs);
    }
  }
}

/** Methods on a google-ads-api Customer that perform network I/O worth retrying. */
const RESILIENT_METHODS = ["query", "mutateResources"] as const;

/**
 * Wrap a google-ads-api Customer's network methods (`query`, `mutateResources`)
 * with {@link withRetry}, in place. Methods that are absent (e.g. a stub) are
 * left untouched. Returns the same object for convenience.
 */
export function wrapCustomerWithResilience<T extends object>(customer: T, config: RetryConfig = {}): T {
  const indexed = customer as Record<string, unknown>;
  for (const method of RESILIENT_METHODS) {
    const original = indexed[method];
    if (typeof original === "function") {
      indexed[method] = (...args: unknown[]) =>
        withRetry(() => (original as (...a: unknown[]) => Promise<unknown>).apply(customer, args), config);
    }
  }
  return customer;
}
