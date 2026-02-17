import express from 'express';
import session from 'express-session';
import { OAuth2Client } from 'google-auth-library';
import prisma, { storeUserCredentials, associateAccount, getUserAccounts, setSelectedAccounts } from '../services/db';
import config from '../config/env';
import logger from '../observability/logger';
import { GoogleAdsApi } from 'google-ads-api';

const app = express();
const port = process.env.PORT || 3000;

function getErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

function getGoogleAdsErrorHint(error: any): string | null {
  const serialized = JSON.stringify(error ?? {});
  if (serialized.includes("NOT_ADS_USER")) {
    return "The Google account used for login is not linked to any Google Ads account.";
  }
  if (serialized.includes("DEVELOPER_TOKEN_NOT_APPROVED")) {
    return "Developer token is not approved for this type of request/account.";
  }
  if (serialized.includes("UNAUTHENTICATED")) {
    return "OAuth token is invalid/expired or the OAuth client configuration is incorrect.";
  }
  if (serialized.includes("USER_PERMISSION_DENIED")) {
    return "The logged-in user does not have permissions on the requested Google Ads accounts.";
  }
  return null;
}

function normalizeCustomerId(raw: string): string {
  const extracted = raw.includes("/") ? raw.split("/").pop() || raw : raw;
  return extracted.replace(/-/g, "");
}

async function discoverManagerChildAccounts(
  client: GoogleAdsApi,
  refreshToken: string,
  managerCustomerId: string
): Promise<string[]> {
  const managerCustomer = client.Customer({
    customer_id: managerCustomerId,
    refresh_token: refreshToken,
    login_customer_id: managerCustomerId,
  });

  const rows = await managerCustomer.query(`
    SELECT
      customer_client.id
    FROM customer_client
    WHERE customer_client.level = 1
  `);

  return rows
    .map((row: any) => String(row?.customer_client?.id || "").trim())
    .filter(Boolean);
}

app.use(express.json());
app.use(session({
  secret: 'mcp-secret',
  resave: false,
  saveUninitialized: true,
}));

const oAuth2Client = new OAuth2Client(
  config.GOOGLE_ADS_CLIENT_ID,
  config.GOOGLE_ADS_CLIENT_SECRET,
  `http://localhost:${port}/oauth2callback`
);

app.get('/login', (req, res) => {
  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/adwords',
    ],
    prompt: 'consent select_account',
  });
  res.redirect(authorizeUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    if (!code || typeof code !== "string") {
      return res.status(400).send("Missing OAuth authorization code.");
    }

    const { tokens } = await oAuth2Client.getToken(code as string);

    if (!tokens.id_token) {
      return res.status(400).send('No ID token received. Ensure OAuth scopes include openid/email/profile.');
    }

    // For this example, we'll use email as userId. 
    // In a real SaaS, you'd get this from the ID token or a separate profile call.
    const ticket = await oAuth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: config.GOOGLE_ADS_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload?.email;

    if (!email) {
      return res.status(400).send('Could not retrieve user email.');
    }

    // 1. Create or update user
    const user = await prisma.user.upsert({
      where: { email },
      update: { name: payload?.name },
      create: { email, name: payload?.name },
    });

    // 2. Resolve refresh token (new token, otherwise existing token if user already connected)
    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const existingCreds = await prisma.googleAdsCredential.findUnique({
        where: { userId: user.id },
      });
      if (!existingCreds?.refreshToken) {
        return res.status(400).send(
          "No refresh token received and no existing token found. " +
          "Revoke app access and try login again with prompt=consent."
        );
      }
      refreshToken = existingCreds.refreshToken;
    }

    // 3. Store credentials
    await storeUserCredentials(user.id, refreshToken);

    // 4. Optional: Auto-discover and associate accounts
    const client = new GoogleAdsApi({
      client_id: config.GOOGLE_ADS_CLIENT_ID,
      client_secret: config.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: config.GOOGLE_ADS_DEVELOPER_TOKEN,
    });
    const discoveredCustomerIds = new Set<string>();
    let discoveryWarning: string | null = null;

    try {
      const discovery = await client.listAccessibleCustomers(refreshToken);

      for (const resourceName of discovery.resource_names) {
        const customerId = normalizeCustomerId(resourceName);
        await associateAccount(user.id, customerId);
        discoveredCustomerIds.add(customerId);

        try {
          const customer = client.Customer({
            customer_id: customerId,
            refresh_token: refreshToken,
            login_customer_id: customerId,
          });

          const meta = await customer.query(`
            SELECT customer.manager
            FROM customer
            LIMIT 1
          `);

          const isManager = Boolean(meta?.[0]?.customer?.manager);
          if (!isManager) {
            continue;
          }

          const childIds = await discoverManagerChildAccounts(client, refreshToken, customerId);
          for (const childId of childIds) {
            await associateAccount(user.id, childId);
            discoveredCustomerIds.add(childId);
          }
        } catch (childDiscoveryError: any) {
          logger.warn(
            { err: childDiscoveryError, userId: user.id, managerCustomerId: customerId },
            "Skipping manager child-account discovery for one manager account"
          );
        }
      }
    } catch (discoveryError: any) {
      const hint = getGoogleAdsErrorHint(discoveryError);
      discoveryWarning =
        hint ??
        `Account auto-discovery failed: ${getErrorMessage(discoveryError)}`;
      logger.warn({ err: discoveryError, userId: user.id }, "Google Ads account discovery failed after OAuth");
    }

    let message =
      `Successfully connected! User ID: ${user.id}. Discovered ${discoveredCustomerIds.size} account(s).\n` +
      `List linked accounts: GET /users/${user.id}/accounts\n` +
      `Select included accounts for MCP calls: POST /users/${user.id}/accounts/select with JSON { "customerIds": ["1234567890"] }`;

    if (discoveryWarning) {
      message += `\nWarning: ${discoveryWarning}`;
    }

    res.send(message);
  } catch (error: any) {
    const errorHint = getGoogleAdsErrorHint(error);
    const details = getErrorMessage(error);
    logger.error({ err: error }, 'OAuth error');
    res.status(500).send(
      `Authentication failed: ${errorHint ?? details}`
    );
  }
});

app.get('/users/:userId/accounts', async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return res.status(404).json({ error: `User ${userId} not found.` });
    }

    const linkedAccounts = await getUserAccounts(userId);
    return res.json({
      user,
      linkedAccounts: linkedAccounts.map(account => ({
        customerId: account.customerId,
        selected: account.isDefault,
      })),
    });
  } catch (error: any) {
    logger.error('List linked accounts error:', error);
    return res.status(500).json({ error: 'Failed to list linked accounts.' });
  }
});

app.post('/users/:userId/accounts/select', async (req, res) => {
  const { userId } = req.params;
  const { customerIds } = req.body as { customerIds?: unknown };

  if (!Array.isArray(customerIds) || customerIds.some(id => typeof id !== "string")) {
    return res.status(400).json({
      error: 'Body must be JSON: { "customerIds": ["1234567890", "..."] }',
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ error: `User ${userId} not found.` });
    }

    const accounts = await setSelectedAccounts(userId, customerIds);
    return res.json({
      userId,
      selectedCustomerIds: accounts.filter(account => account.isDefault).map(account => account.customerId),
      linkedCustomerIds: accounts.map(account => account.customerId),
    });
  } catch (error: any) {
    logger.error('Select accounts error:', error);
    return res.status(500).json({ error: 'Failed to update selected accounts.' });
  }
});

app.listen(port, () => {
  logger.info(`SaaS Auth Server running at http://localhost:${port}`);
  logger.info(`Visit http://localhost:${port}/login to connect a Google Ads account.`);
});
