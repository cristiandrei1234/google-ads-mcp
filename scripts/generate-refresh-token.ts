/**
 * Generate a Google Ads API refresh token (single-operator mode) via the modern
 * loopback OAuth flow. The legacy OOB flow (urn:ietf:wg:oauth:2.0:oob) was shut
 * off by Google in 2022, so this spins a tiny localhost server to capture the
 * authorization code automatically.
 *
 *   npm run generate-token
 *
 * Then open the printed URL, consent with the Google account that has Google Ads
 * access. The refresh token is saved to the same environment file used by the MCP
 * server (GOOGLE_ADS_MCP_ENV, user config, or the project fallback).
 *
 * NOTE: your OAuth client must allow the loopback redirect. "Desktop app" clients
 * allow any http://localhost port by default; for a "Web application" client, add
 * http://localhost:4567/oauth2callback as an authorized redirect URI.
 */
import { OAuth2Client } from "google-auth-library";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { loadEnvironment } from "../src/config/envFile.js";

const injectedRefreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const envFile = loadEnvironment();
const state = randomBytes(32).toString("hex");

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
const PORT = Number(process.env.OAUTH_PORT ?? 4567);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Error: set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env first.");
  process.exit(1);
}

/** Write/replace GOOGLE_ADS_REFRESH_TOKEN in .env (uncommented). */
function writeRefreshTokenToEnv(token: string): void {
  const path = envFile;
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const line = `GOOGLE_ADS_REFRESH_TOKEN=${token}`;
  if (/^#?\s*GOOGLE_ADS_REFRESH_TOKEN=.*$/m.test(content)) {
    content = content.replace(/^#?\s*GOOGLE_ADS_REFRESH_TOKEN=.*$/m, () => line);
  } else {
    content += (content.endsWith("\n") ? "" : "\n") + line + "\n";
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: "https://www.googleapis.com/auth/adwords",
  prompt: "consent", // force a fresh refresh token
  state,
});

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }
  const callback = new URL(req.url, REDIRECT_URI);
  if (callback.pathname !== "/oauth2callback" || callback.searchParams.get("state") !== state) {
    res.writeHead(400).end("Invalid OAuth callback state.");
    return;
  }
  const code = callback.searchParams.get("code");
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
      "<h2>Success.</h2><p>Refresh token saved to the MCP configuration file. Restart your MCP client. You can close this tab.</p>"
    );
    console.log(`\n✓ Refresh token saved to ${envFile}. Restart your MCP client to load it.`);
    if (injectedRefreshToken && injectedRefreshToken !== tokens.refresh_token) {
      console.log("If the launcher sets GOOGLE_ADS_REFRESH_TOKEN in its env block, remove/update that entry: it overrides the token in this file.");
    }
    server.close();
    process.exit(0);
  } catch {
    res.writeHead(500).end("Token exchange failed.");
    console.error("\nToken exchange failed. Check the OAuth client/redirect configuration and retry. No credentials were logged.");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "localhost", () => {
  console.log("For persistent access, check Google Cloud → Google Auth Platform → Audience: External apps in Testing issue Google Ads refresh tokens that expire after 7 days. Switch to In production, then generate a new token (Google verification may be required).");
  console.log(`Token destination: ${envFile}\n`);
  console.log("Authorize this app by visiting this URL (sign in with the Google Ads account):\n");
  console.log(authUrl);
  console.log(`\nWaiting for the OAuth redirect on ${REDIRECT_URI} ...`);
});
