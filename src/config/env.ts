import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .transform(s => s.trim())
    .refine(
      s => s.startsWith('postgres://') || s.startsWith('postgresql://'),
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
  // Force every mutation to run as validate-only (no writes) regardless of the
  // per-call dryRun flag. Accepts 1/true/yes (case-insensitive); anything else
  // (incl. unset) is false.
  GOOGLE_ADS_VALIDATE_ONLY: z
    .string()
    .optional()
    .transform(s => ['1', 'true', 'yes'].includes((s ?? '').trim().toLowerCase())),
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
