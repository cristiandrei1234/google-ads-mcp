import { OAuth2Client } from "google-auth-library";
import { loadEnvironment } from "../src/config/envFile.js";

const envFile = loadEnvironment();
const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();

async function testToken() {
  if (!clientId || !clientSecret || !refreshToken) {
    console.error(`Missing Google OAuth credentials. Check ${envFile} and the MCP launcher's env block.`);
    process.exitCode = 1;
    return;
  }
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  try {
    await client.getAccessToken();
    console.log("✓ Google accepted the refresh token and issued an access token without browser login. The SDK repeats this automatically as needed.");
    console.log("Google does not expose the refresh token's remaining lifetime here. If access stops after ~7 days, check Google Auth Platform → Audience → In production, then generate a new token.");
  } catch (error: unknown) {
    // Never print Gaxios errors: they can contain request credentials/tokens.
    const code = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error;
    if (code === "invalid_grant") {
      console.error("Google rejected the refresh token (expired, revoked, or subject to an account/session policy). For ~7-day failures, check Google Auth Platform → Audience: Testing expires Google Ads refresh tokens after 7 days. Switch to In production, generate a new token, and restart the MCP client. Update/remove launcher GOOGLE_ADS_REFRESH_TOKEN overrides too.");
    } else if (code === "invalid_client" || code === "unauthorized_client") {
      console.error("Google rejected the OAuth client. Check that CLIENT_ID and CLIENT_SECRET belong to the client that issued this refresh token.");
    } else {
      console.error("Token refresh failed. Check network connectivity and Google OAuth configuration. No credentials were logged.");
    }
    process.exitCode = 1;
  }
}

await testToken();
