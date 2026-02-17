import { google } from 'googleapis';
import config from '../../config/env';
import logger from '../../observability/logger';
import { getUserCredentials } from '../db';

const authClientCache = new Map<string, any>();

function buildAuthClient(refreshToken: string) {
  const client = new google.auth.OAuth2(
    config.GOOGLE_ADS_CLIENT_ID,
    config.GOOGLE_ADS_CLIENT_SECRET
  );
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export async function getMerchantAuth(userId?: string) {
  let refreshToken = config.GOOGLE_ADS_REFRESH_TOKEN;
  let cacheKey = "env";

  if (userId) {
    const creds = await getUserCredentials(userId);
    if (!creds) {
      throw new Error(`No credentials found for user ${userId}. Please connect your account first.`);
    }
    refreshToken = creds.refreshToken;
    cacheKey = `user:${userId}`;
    logger.info(`Using database credentials for Merchant Center user ${userId}`);
  }

  if (!refreshToken) {
    throw new Error(
      "GOOGLE_ADS_REFRESH_TOKEN is missing. " +
      "Pass userId (dynamic OAuth mode) or configure single-user env credentials."
    );
  }

  if (!authClientCache.has(cacheKey)) {
    authClientCache.set(cacheKey, buildAuthClient(refreshToken));
    logger.info(`Merchant Center (Content API) auth client initialized for ${cacheKey}`);
  }

  return authClientCache.get(cacheKey);
}

export async function getContentService(userId?: string) {
  const auth = await getMerchantAuth(userId);
  return google.content({
    version: 'v2.1',
    auth: auth,
  });
}
