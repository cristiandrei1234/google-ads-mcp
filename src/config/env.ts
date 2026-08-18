import dotenv from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Load .env from the first candidate that exists, so the server works
// regardless of the launcher's working directory (e.g. Claude Desktop spawns it
// from System32) AND when the package is installed globally or run via `npx`,
// where the package-relative path resolves inside node_modules. Variables
// already present in process.env always win: dotenv never overwrites them, and
// MCP clients inject their configuration exactly that way. `quiet` suppresses
// dotenv's stdout banner, which would otherwise corrupt the stdio MCP JSON-RPC
// stream.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_CANDIDATES = [
  process.env.GOOGLE_ADS_MCP_ENV,
  path.join(os.homedir(), '.config', 'google-ads-mcp', '.env'),
  // Project root is two levels up from src/config (or dist/config).
  path.resolve(moduleDir, '../../.env'),
];
for (const candidate of ENV_FILE_CANDIDATES) {
  if (candidate && fs.existsSync(candidate)) {
    dotenv.config({ path: candidate, quiet: true });
    break;
  }
}

const envSchema = z.object({
  // Optional: only multi-tenant mode (HTTP transport, orgs, grants, audit) needs
  // Postgres. Single-operator stdio runs on GOOGLE_ADS_REFRESH_TOKEN alone and
  // never opens a connection, so requiring it here would block that mode.
  DATABASE_URL: z
    .string()
    .optional()
    .transform(s => s?.trim())
    .refine(
      s => s === undefined || s.startsWith('postgres://') || s.startsWith('postgresql://'),
      'DATABASE_URL must be a PostgreSQL connection string'
    ),
  GOOGLE_ADS_CLIENT_ID: z.string().transform(s => s.trim()),
  GOOGLE_ADS_CLIENT_SECRET: z.string().transform(s => s.trim()),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().transform(s => s.trim()),
  GOOGLE_ADS_REFRESH_TOKEN: z
    .string()
    .optional()
    .transform(s => s?.trim())
    .refine(s => s === undefined || s.length > 0, "GOOGLE_ADS_REFRESH_TOKEN cannot be empty"),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional().transform(s => s?.trim().replace(/-/g, '')),
  // Resilience for outbound Google Ads API calls. Per-attempt timeout (ms) and
  // number of retries on transient (429/5xx/UNAVAILABLE/network) failures.
  GOOGLE_ADS_API_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  GOOGLE_ADS_API_MAX_RETRIES: z.coerce.number().int().min(0).optional(),
  // Force every mutation to run as validate-only (no writes) regardless of the
  // per-call dryRun flag. Accepts 1/true/yes (case-insensitive); anything else
  // (incl. unset) is false.
  GOOGLE_ADS_VALIDATE_ONLY: z
    .string()
    .optional()
    .transform(s => ['1', 'true', 'yes'].includes((s ?? '').trim().toLowerCase())),
  // Comma-separated tool groups to register (see policies/toolsets.ts), or
  // 'all'. Unset registers the default groups.
  GOOGLE_ADS_TOOLSETS: z.string().optional().transform(s => s?.trim()),
  // Ceiling on the characters a single tool result may put into the model's
  // context. Oversized results are truncated with a message telling the caller
  // how to narrow the query. Default: 100_000.
  GOOGLE_ADS_MAX_RESULT_CHARS: z.coerce.number().int().positive().optional(),
  MERCHANT_CENTER_ID: z.string().optional().transform(s => s?.trim()),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Encryption key for Google Ads refresh tokens at rest (base64, 32 bytes).
  // Optional so env-only / no-DB paths still boot; required (and shape-checked)
  // by assertHttpServerConfig() before the HTTP server starts.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform(s => s?.trim())
    .refine(
      s => s === undefined || Buffer.from(s, 'base64').length === 32,
      'TOKEN_ENCRYPTION_KEY must be base64 that decodes to exactly 32 bytes (openssl rand -base64 32)'
    ),
  // Previous encryption keys (comma-separated base64, 32 bytes each) used only
  // to DECRYPT during key rotation; new writes use TOKEN_ENCRYPTION_KEY.
  TOKEN_ENCRYPTION_KEY_PREVIOUS: z.string().optional().transform(s => s?.trim()),
  // Better Auth (production multi-tenant auth). Optional at parse time so stdio
  // dev and unit tests boot; assertHttpServerConfig() requires them for HTTP.
  BETTER_AUTH_SECRET: z
    .string()
    .optional()
    .transform(s => s?.trim())
    .refine(s => s === undefined || s.length >= 32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().optional().transform(s => s?.trim()),
  NODE_ENV: z.string().optional().transform(s => s?.trim()),

  // Transactional email (Resend). When RESEND_API_KEY is set, verification /
  // reset / invitation emails are actually delivered; otherwise they are logged.
  RESEND_API_KEY: z.string().optional().transform(s => s?.trim()),
  EMAIL_FROM: z.string().optional().transform(s => s?.trim()),
  EMAIL_VERIFICATION: z.enum(['on', 'off']).optional(),
}).superRefine((env, ctx) => {
  // Every mode needs a credential source. Without either variable the server
  // would boot and then fail on the first tool call, which is far harder to
  // diagnose than refusing to start.
  if (!env.DATABASE_URL && !env.GOOGLE_ADS_REFRESH_TOKEN) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_ADS_REFRESH_TOKEN'],
      message:
        'No credential source configured: set GOOGLE_ADS_REFRESH_TOKEN for ' +
        'single-operator (stdio) mode, or DATABASE_URL for multi-tenant mode.',
    });
  }
});

export type Config = z.infer<typeof envSchema>;

const config = envSchema.parse(process.env);

export default config;

/**
 * Fail-closed validation for the HTTP/auth server. Call this at startup BEFORE
 * listening so production never boots with a default signing key, a localhost
 * origin, or a missing encryption key. Throws with an actionable message.
 */
export function assertHttpServerConfig(): void {
  const problems: string[] = [];
  if (!config.DATABASE_URL) {
    problems.push('DATABASE_URL is required (PostgreSQL connection string).');
  }
  if (!config.BETTER_AUTH_SECRET) {
    problems.push('BETTER_AUTH_SECRET is required (>=32 chars; openssl rand -base64 32).');
  }
  if (!config.TOKEN_ENCRYPTION_KEY) {
    problems.push('TOKEN_ENCRYPTION_KEY is required (base64, 32 bytes; openssl rand -base64 32).');
  }
  if (!config.BETTER_AUTH_URL) {
    problems.push('BETTER_AUTH_URL is required (public base URL).');
  } else if (config.NODE_ENV === 'production' && !config.BETTER_AUTH_URL.startsWith('https://')) {
    problems.push('BETTER_AUTH_URL must be https:// in production.');
  }
  if (problems.length > 0) {
    throw new Error(`Invalid HTTP server configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * True when a database is configured, i.e. the multi-tenant features
 * (organizations, grants, audit trail, admin tools) can work at all.
 *
 * It lives here rather than in the Prisma module on purpose: callers use it to
 * decide whether to touch that module, and importing it from there would load
 * `@prisma/client` into the single-operator process just to ask the question.
 */
export function hasDatabase(): boolean {
  return Boolean(config.DATABASE_URL);
}
