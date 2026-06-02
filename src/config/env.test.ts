import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Keep dotenv from loading the repo's real .env into process.env during tests
// (we control every variable explicitly via stubEnv for determinism).
vi.mock("dotenv", () => ({ default: { config: vi.fn() }, config: vi.fn() }));

const REQUIRED = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  GOOGLE_ADS_CLIENT_ID: "cid",
  GOOGLE_ADS_CLIENT_SECRET: "secret",
  GOOGLE_ADS_DEVELOPER_TOKEN: "devtoken",
};

// A valid base64 string decoding to exactly 32 bytes.
const KEY32 = Buffer.alloc(32, 7).toString("base64");

// Clear every variable the schema reads, then apply a base of required vars.
function resetEnv(overrides: Record<string, string | undefined> = {}): void {
  const keys = [
    "DATABASE_URL",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_VALIDATE_ONLY",
    "MERCHANT_CENTER_ID",
    "LOG_LEVEL",
    "TOKEN_ENCRYPTION_KEY",
    "TOKEN_ENCRYPTION_KEY_PREVIOUS",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "NODE_ENV",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "EMAIL_VERIFICATION",
  ];
  for (const k of keys) vi.stubEnv(k, undefined as unknown as string);
  for (const [k, v] of Object.entries({ ...REQUIRED, ...overrides })) {
    vi.stubEnv(k, v as string);
  }
}

async function loadEnv(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  resetEnv(overrides);
  return import("./env.js");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env config parsing", () => {
  it("parses a minimal valid env with defaults", async () => {
    const { default: config } = await loadEnv();
    expect(config.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
    expect(config.LOG_LEVEL).toBe("info"); // default
    expect(config.GOOGLE_ADS_VALIDATE_ONLY).toBe(false); // unset → false
    expect(config.GOOGLE_ADS_REFRESH_TOKEN).toBeUndefined();
    expect(config.GOOGLE_ADS_LOGIN_CUSTOMER_ID).toBeUndefined();
  });

  it("trims required string fields", async () => {
    const { default: config } = await loadEnv({
      GOOGLE_ADS_CLIENT_ID: "  spaced  ",
      DATABASE_URL: "  postgresql://u@h/db  ",
    });
    expect(config.GOOGLE_ADS_CLIENT_ID).toBe("spaced");
    expect(config.DATABASE_URL).toBe("postgresql://u@h/db");
  });

  it("accepts the postgresql:// scheme as well as postgres://", async () => {
    const { default: config } = await loadEnv({ DATABASE_URL: "postgresql://u@h/db" });
    expect(config.DATABASE_URL).toBe("postgresql://u@h/db");
  });

  it("rejects a DATABASE_URL with a bad scheme", async () => {
    await expect(loadEnv({ DATABASE_URL: "mysql://u@h/db" })).rejects.toThrow(
      /PostgreSQL connection string/
    );
  });

  it("strips dashes from GOOGLE_ADS_LOGIN_CUSTOMER_ID", async () => {
    const { default: config } = await loadEnv({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: " 123-456-7890 " });
    expect(config.GOOGLE_ADS_LOGIN_CUSTOMER_ID).toBe("1234567890");
  });

  it("accepts a non-empty GOOGLE_ADS_REFRESH_TOKEN", async () => {
    const { default: config } = await loadEnv({ GOOGLE_ADS_REFRESH_TOKEN: "  rt  " });
    expect(config.GOOGLE_ADS_REFRESH_TOKEN).toBe("rt");
  });

  it("rejects an empty (whitespace) GOOGLE_ADS_REFRESH_TOKEN", async () => {
    await expect(loadEnv({ GOOGLE_ADS_REFRESH_TOKEN: "   " })).rejects.toThrow(
      /GOOGLE_ADS_REFRESH_TOKEN cannot be empty/
    );
  });

  it.each(["1", "true", "yes", "TRUE", "Yes"])(
    "treats %s as GOOGLE_ADS_VALIDATE_ONLY=true",
    async (val) => {
      const { default: config } = await loadEnv({ GOOGLE_ADS_VALIDATE_ONLY: val });
      expect(config.GOOGLE_ADS_VALIDATE_ONLY).toBe(true);
    }
  );

  it("treats other GOOGLE_ADS_VALIDATE_ONLY values as false", async () => {
    const { default: config } = await loadEnv({ GOOGLE_ADS_VALIDATE_ONLY: "no" });
    expect(config.GOOGLE_ADS_VALIDATE_ONLY).toBe(false);
  });

  it("parses MERCHANT_CENTER_ID and trims it", async () => {
    const { default: config } = await loadEnv({ MERCHANT_CENTER_ID: "  mc1  " });
    expect(config.MERCHANT_CENTER_ID).toBe("mc1");
  });

  it("accepts each valid LOG_LEVEL enum value", async () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      const { default: config } = await loadEnv({ LOG_LEVEL: level });
      expect(config.LOG_LEVEL).toBe(level);
    }
  });

  it("rejects an invalid LOG_LEVEL", async () => {
    await expect(loadEnv({ LOG_LEVEL: "trace" })).rejects.toThrow();
  });

  it("accepts a valid 32-byte base64 TOKEN_ENCRYPTION_KEY", async () => {
    const { default: config } = await loadEnv({ TOKEN_ENCRYPTION_KEY: KEY32 });
    expect(config.TOKEN_ENCRYPTION_KEY).toBe(KEY32);
  });

  it("rejects a TOKEN_ENCRYPTION_KEY that does not decode to 32 bytes", async () => {
    await expect(loadEnv({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") })).rejects.toThrow(
      /32 bytes/
    );
  });

  it("parses TOKEN_ENCRYPTION_KEY_PREVIOUS and trims it", async () => {
    const { default: config } = await loadEnv({ TOKEN_ENCRYPTION_KEY_PREVIOUS: "  k1,k2  " });
    expect(config.TOKEN_ENCRYPTION_KEY_PREVIOUS).toBe("k1,k2");
  });

  it("accepts a BETTER_AUTH_SECRET of at least 32 chars", async () => {
    const secret = "x".repeat(32);
    const { default: config } = await loadEnv({ BETTER_AUTH_SECRET: secret });
    expect(config.BETTER_AUTH_SECRET).toBe(secret);
  });

  it("rejects a BETTER_AUTH_SECRET shorter than 32 chars", async () => {
    await expect(loadEnv({ BETTER_AUTH_SECRET: "short" })).rejects.toThrow(
      /at least 32 characters/
    );
  });

  it("parses email + auth url + node env fields", async () => {
    const { default: config } = await loadEnv({
      RESEND_API_KEY: "  re_key  ",
      EMAIL_FROM: "  from@x.com  ",
      EMAIL_VERIFICATION: "on",
      BETTER_AUTH_URL: "  https://app.example.com  ",
      NODE_ENV: "  production  ",
    });
    expect(config.RESEND_API_KEY).toBe("re_key");
    expect(config.EMAIL_FROM).toBe("from@x.com");
    expect(config.EMAIL_VERIFICATION).toBe("on");
    expect(config.BETTER_AUTH_URL).toBe("https://app.example.com");
    expect(config.NODE_ENV).toBe("production");
  });

  it("rejects an invalid EMAIL_VERIFICATION enum value", async () => {
    await expect(loadEnv({ EMAIL_VERIFICATION: "maybe" })).rejects.toThrow();
  });
});

describe("assertHttpServerConfig", () => {
  it("throws listing all missing fields when nothing is configured", async () => {
    const { assertHttpServerConfig } = await loadEnv();
    expect(() => assertHttpServerConfig()).toThrow(/Invalid HTTP server configuration/);
    try {
      assertHttpServerConfig();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/BETTER_AUTH_SECRET is required/);
      expect(msg).toMatch(/TOKEN_ENCRYPTION_KEY is required/);
      expect(msg).toMatch(/BETTER_AUTH_URL is required/);
    }
  });

  it("passes when all required HTTP fields are present (non-production)", async () => {
    const { assertHttpServerConfig } = await loadEnv({
      BETTER_AUTH_SECRET: "y".repeat(32),
      TOKEN_ENCRYPTION_KEY: KEY32,
      BETTER_AUTH_URL: "http://localhost:3000",
      NODE_ENV: "development",
    });
    expect(() => assertHttpServerConfig()).not.toThrow();
  });

  it("requires https BETTER_AUTH_URL in production", async () => {
    const { assertHttpServerConfig } = await loadEnv({
      BETTER_AUTH_SECRET: "y".repeat(32),
      TOKEN_ENCRYPTION_KEY: KEY32,
      BETTER_AUTH_URL: "http://app.example.com",
      NODE_ENV: "production",
    });
    expect(() => assertHttpServerConfig()).toThrow(/must be https:\/\/ in production/);
  });

  it("passes with https BETTER_AUTH_URL in production", async () => {
    const { assertHttpServerConfig } = await loadEnv({
      BETTER_AUTH_SECRET: "y".repeat(32),
      TOKEN_ENCRYPTION_KEY: KEY32,
      BETTER_AUTH_URL: "https://app.example.com",
      NODE_ENV: "production",
    });
    expect(() => assertHttpServerConfig()).not.toThrow();
  });
});
