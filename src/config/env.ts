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
  MERCHANT_CENTER_ID: z.string().optional().transform(s => s?.trim()),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

const config = envSchema.parse(process.env);

export default config;
