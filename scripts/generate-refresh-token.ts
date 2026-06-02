/**
 * Generate a Google Ads API refresh token (single-operator mode) via the modern
 * loopback OAuth flow. The legacy OOB flow (urn:ietf:wg:oauth:2.0:oob) was shut
 * off by Google in 2022, so this spins a tiny localhost server to capture the
 * authorization code automatically.
 *
 *   npm run generate-token
 *
 * Then open the printed URL, consent with the Google account that has Google Ads
 * access, and the refresh token is written into .env as GOOGLE_ADS_REFRESH_TOKEN.
 *
 * NOTE: your OAuth client must allow the loopback redirect. "Desktop app" clients
 * allow any http://localhost port by default; for a "Web application" client, add
 * http://localhost:4567/oauth2callback as an authorized redirect URI.
 */
import { OAuth2Client } from "google-auth-library";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import dotenv from "dotenv";

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_PORT ?? 4567);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Error: set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env first.");
  process.exit(1);
}

/** Write/replace GOOGLE_ADS_REFRESH_TOKEN in .env (uncommented). */
function writeRefreshTokenToEnv(token: string): void {
  const path = ".env";
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const line = `GOOGLE_ADS_REFRESH_TOKEN=${token}`;
  if (/^#?\s*GOOGLE_ADS_REFRESH_TOKEN=.*$/m.test(content)) {
    content = content.replace(/^#?\s*GOOGLE_ADS_REFRESH_TOKEN=.*$/m, line);
  } else {
    content += (content.endsWith("\n") ? "" : "\n") + line + "\n";
  }
  writeFileSync(path, content);
}

const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: "https://www.googleapis.com/auth/adwords",
  prompt: "consent", // force a fresh refresh token
});

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, REDIRECT_URI).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Missing authorization code.");
    return;
  }
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    if (!tokens.refresh_token) {
      res.writeHead(400).end("No refresh token returned. Revoke prior access and retry.");
      console.error("\nNo refresh token returned (already granted?). Revoke at https://myaccount.google.com/permissions and retry.");
      server.close();
      return;
    }
    writeRefreshTokenToEnv(tokens.refresh_token);
    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<h2>Success.</h2><p>Refresh token saved to .env. You can close this tab.</p>"
    );
    console.log("\n✓ Refresh token retrieved and written to .env (GOOGLE_ADS_REFRESH_TOKEN).");
    server.close();
    process.exit(0);
  } catch (error: any) {
    res.writeHead(500).end("Token exchange failed.");
    console.error("\nToken exchange failed:", error?.message || error);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log("Authorize this app by visiting this URL (sign in with the Google Ads account):\n");
  console.log(authUrl);
  console.log(`\nWaiting for the OAuth redirect on ${REDIRECT_URI} ...`);
});
