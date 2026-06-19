# Google Ads MCP — Web dashboard

Next.js (App Router) agency dashboard for the MCP server. Owners/employees sign
in, link their Google Ads account via OAuth, and admins assign per-account access
to the team. It is a thin client over the server's Better Auth + admin API.

## Run (dev)

```bash
cp .env.local.example .env.local        # NEXT_PUBLIC_API_URL = the MCP server URL
npm install
npm run dev                             # http://localhost:3000
```

The MCP server must be running (default dev URL `http://localhost:3939`) with
`WEB_APP_ORIGIN=http://localhost:3000` so CORS allows credentialed requests, and
`${BETTER_AUTH_URL}/connect/google-ads/callback` registered as an authorized
redirect URI in the Google OAuth client.

## Pages
- `/sign-up`, `/sign-in` — Better Auth email/password.
- `/dashboard` — create your agency (organization); then: connect Google Ads,
  view team members, and grant/revoke per-account access.
- `/connect/result` — OAuth connect landing (success/error).

## Build
```bash
npm run typecheck
npm run build
```

Deploy as a separate app (e.g. Vercel) pointing `NEXT_PUBLIC_API_URL` at the
production MCP server, and set the server's `WEB_APP_ORIGIN` to this app's origin.
