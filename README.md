# Google Ads MCP

A Model Context Protocol server for the Google Ads API. It exposes reporting,
campaign / ad group / keyword / ad lifecycle, negatives, audiences, conversions,
assets and Performance Max, Merchant Center and Shopping, experiments, bidding
and billing — 345 tools in total — to an AI assistant.

It runs two ways:

- **Single operator (stdio)** — your own credentials, one process, no database.
  This is what `npx` gives you and what most people want.
- **Multi-tenant (HTTP)** — an agency service: employees authenticate, each is
  scoped to the client accounts they are allowed to touch, every call is audited.
  Needs Postgres.

---

## Quickstart

Four environment variables and you are running:

```bash
GOOGLE_ADS_CLIENT_ID=...        \
GOOGLE_ADS_CLIENT_SECRET=...    \
GOOGLE_ADS_DEVELOPER_TOKEN=...  \
GOOGLE_ADS_REFRESH_TOKEN=...    \
npx -y @automwise/google-ads-mcp
```

No Postgres, no migrations: with a refresh token the server never opens a
database connection, and `@prisma/client` is not even loaded into the process.

Where those values come from:

| Variable | Where to get it |
|---|---|
| `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` | An OAuth 2.0 **Desktop app** client in Google Cloud, with the Google Ads API enabled |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Your Google Ads **manager (MCC)** account, under API Center |
| `GOOGLE_ADS_REFRESH_TOKEN` | Run `npm run generate-token` in a clone: it opens the consent screen and writes the token to `.env` |

Optional but common: `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — your MCC id (digits only)
when the accounts you manage sit under a manager account.

---

## Toolsets

345 tools is more than any model should carry. Tools are grouped, and only the
groups you ask for are registered — a disabled group costs nothing, because it is
never registered at all.

```bash
GOOGLE_ADS_TOOLSETS=core,reporting     # the default
GOOGLE_ADS_TOOLSETS=all                # everything
GOOGLE_ADS_TOOLSETS=core,shopping      # pick your own
```

| Group | What it covers |
|---|---|
| `core` | Account discovery, GAQL, campaigns (CRUD, targeting, budgets, cloning), ad groups, ads, keyword lifecycle |
| `reporting` | Search terms, change history, policy findings, recommendations, Local Services leads |
| `keywords` | Bulk keyword operations and keyword-level updates |
| `negatives` | Negative keywords, shared negative lists, account-level negatives |
| `audiences` | User lists, custom and combined audiences, Customer Match |
| `conversions` | Conversion actions, goals, offline uploads and adjustments |
| `assets` | Assets, asset groups, asset sets, Performance Max signals |
| `shopping` | Merchant Center, product feeds, listing groups, vertical resources |
| `planning` | Keyword Planner, forecasts, reach planning |
| `experiments` | Campaign experiments and drafts |
| `bidding` | Portfolio bidding strategies, seasonality adjustments, data exclusions |
| `billing` | Invoices, account budgets, billing setups, identity verification |
| `admin` | Multi-tenant user status (registered only when a database is configured) |
| `resources` | Generated raw list/get/create/update/remove tools over ~90 Google Ads resources, plus batch jobs |

The default (`core,reporting`) advertises 46 tools — about 7k tokens of
`tools/list`, against 49k for the full surface.

An unknown group name refuses to start and prints the valid ones, rather than
silently registering the wrong set.

---

## Client configuration

### Claude Code

```bash
claude mcp add google-ads --env GOOGLE_ADS_CLIENT_ID=... \
  --env GOOGLE_ADS_CLIENT_SECRET=... \
  --env GOOGLE_ADS_DEVELOPER_TOKEN=... \
  --env GOOGLE_ADS_REFRESH_TOKEN=... \
  -- npx -y @automwise/google-ads-mcp
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "npx",
      "args": ["-y", "@automwise/google-ads-mcp"],
      "env": { "GOOGLE_ADS_MCP_ENV": "/home/you/.config/google-ads-mcp/.env" }
    }
  }
}
```

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.google_ads]
command = "npx"
args = ["-y", "@automwise/google-ads-mcp"]
env = { GOOGLE_ADS_MCP_ENV = "/home/you/.config/google-ads-mcp/.env" }
```

### Keep the secrets out of your repository

The obvious way to configure an MCP server is to paste the credentials into the
client's `env` block. Do not do that in a **project-scoped** config
(`.mcp.json`, `.vscode/mcp.json`, a committed `config.toml`): a Google Ads client
secret and a refresh token together are full account access, and that file gets
committed.

The server reads a `.env` from the first location that exists:

1. `$GOOGLE_ADS_MCP_ENV`
2. `~/.config/google-ads-mcp/.env`
3. the package's own directory (a local clone)

Variables already exported in the environment always win, so a client's `env`
block still overrides the file. The recommended setup is a `0600` file at
`~/.config/google-ads-mcp/.env`, and nothing sensitive in the client config:

```bash
mkdir -p ~/.config/google-ads-mcp
install -m 600 /dev/null ~/.config/google-ads-mcp/.env
$EDITOR ~/.config/google-ads-mcp/.env
```

---

## Conventions the caller must know

- **`customerId` is digits only** — `1234567890`, not `123-456-7890`.
- **Destructive tools need `confirm: true`.** Everything matching `remove_*`,
  `delete_*`, `unlink_*` and `update_customer` refuses to run without it.
  `GOOGLE_ADS_VALIDATE_ONLY=1` additionally forces every mutation account-wide to
  run validate-only.
- **`run_gaql_query` is read-only**, and gets a `LIMIT` injected when the
  statement has none.
- **Results are bounded.** A tool result is capped at
  `GOOGLE_ADS_MAX_RESULT_CHARS` (default 100,000). On overflow the response says
  how many rows of how many came back and what to narrow, instead of silently
  truncating.

---

## Self-hosted multi-tenant mode

For an agency with employees: everyone authenticates, everyone is scoped to the
client accounts they were granted, and every tool call is recorded.

### Identity model

```
Agency MCC (admin)  ->  Employee MCC (per employee)  ->  Client accounts
```

- The agency is an **Organization**; employees are **Members** with roles
  (`owner`/`admin` = full, `member` = write, `viewer`/`analyst` = read-only).
- Each employee links their own Google account, producing a **GoogleAdsConnection**
  (their MCC + refresh token, **encrypted at rest**). The agency admin links the
  agency MCC (parent of the employee MCCs).
- An employee may operate on a client account only if they hold an **AccountGrant**
  for it (with `READ`/`WRITE`/`ADMIN` level). No grant means a hard error.

Identity is resolved from the authenticated session (Better Auth) on every request
and is **never** taken from tool arguments — a client cannot impersonate another
tenant. No tool schema advertises a user id.

### Deploy (VPS + Docker + Caddy)

```bash
cp .env.prod.example .env.prod                 # fill DOMAIN, secrets, creds
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This runs Postgres (persistent volume + daily `pg_dump` backups), the MCP HTTP
server (auto-migrates on start), and Caddy (automatic Let's Encrypt TLS on
`$DOMAIN`, ports 80/443). DNS for `$DOMAIN` must point at the host.

The HTTP server fails closed at startup: without `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` or `BETTER_AUTH_URL` it refuses to
boot, and lists what is missing.

### Connecting an MCP client

The server speaks **Streamable HTTP** at `POST/GET/DELETE /mcp`, gated by auth.

1. Authenticate via `/api/auth/*` (sign up / sign in, or Google) to obtain a
   bearer token (`set-auth-token` response header) or session cookie.
2. Send MCP requests to `/mcp` with `Authorization: Bearer <token>` and
   `Accept: application/json, text/event-stream`.

Claude-style remote MCP connectors discover authorization via the Better Auth
`mcp` plugin's OAuth/OIDC metadata.

### Enterprise SSO (SAML 2.0 / OIDC)

Powered by `@better-auth/sso`. An agency admin registers their IdP once, then
employees sign in through it (federated users are auto-linked to the org, so the
same RBAC/grants apply).

```bash
# Register a provider for the org (admin, authenticated):
POST /api/auth/sso/register   { issuer, domain, providerId, samlConfig | oidcConfig, organizationId }
# Employees sign in:
POST /api/auth/sign-in/sso    { email | providerId, callbackURL }
# SAML SP metadata for the IdP:
GET  /api/auth/sso/saml2/sp/metadata?providerId=...
```

Validate against a real IdP (Okta, Azure AD, Google Workspace SAML) before
rollout — the wiring is exercised by `smoke-auth`, but the IdP handshake is not.
**SCIM** (IdP-driven user provisioning) is not included; it is a separate
protocol build tracked as a roadmap item.

### Onboarding: connecting a Google Ads account

A signed-in member (agency owner or employee) links their own Google Ads account
via OAuth; the agency MCC and per-employee MCCs are both supported (one
`GoogleAdsConnection` per linked MCC, owned by the member).

```bash
# 1. Member opens this in a browser (auth-gated) -> Google consent (adwords scope):
GET  /connect/google-ads
#    The callback stores the encrypted refresh token + auto-detected login MCC,
#    then redirects to ${WEB_APP_ORIGIN}/connect/result?status=connected&mcc=...
GET  /connect/google-ads/callback        # (Google redirects here)

# Admin onboarding API (org admin/owner only):
GET    /admin/connections                # linked MCCs in the org (no secrets)
GET    /admin/members                    # members, to assign grants to
GET    /admin/accessible-accounts?connectionId=...   # client accounts under an MCC
POST   /admin/grants    { memberId, connectionId, customerId, accessLevel }
DELETE /admin/grants    { memberId, connectionId, customerId }
```

Register `${BETTER_AUTH_URL}/connect/google-ads/callback` as an authorized
redirect URI in your Google Cloud OAuth client (alongside the social-login
callback). The OAuth client needs the Google Ads API enabled and the `adwords`
scope. These endpoints are the backend the web dashboard drives.

### Web dashboard (`web/`)

A Next.js dashboard (`web/`, deployed separately) gives owners and employees a
self-serve UI over the auth + onboarding API: sign up, create an agency, connect
Google Ads (the OAuth button), and assign per-account access to the team. See
`web/README.md`. Set the server's `WEB_APP_ORIGIN` to the dashboard's origin so
CORS allows credentialed requests.

### Operations runbook

- **Onboard an employee**: invite them to the organization (Better Auth
  `organization` plugin), they sign in, link their MCC, then an admin grants them
  the client accounts (`AccountGrant`).
- **Offboard**: ban/remove the member (Better Auth `admin`/`organization`); their
  grants and connections cascade.
- **Audit**: `GET /audit?limit=100[&customerId=...]` (org admin only).
- **Health**: `GET /healthz` (liveness, always cheap) and `GET /health/ready`
  (readiness — verifies Postgres answers; returns 503 when the DB is down so the
  proxy stops routing). The prod compose health-checks `mcp` on `/health/ready`.
- **Metrics**: `GET /metrics` (Prometheus) when `METRICS_TOKEN` is set — scrape
  with `Authorization: Bearer $METRICS_TOKEN`. Exposes tool invocation
  counts/latency, Google Ads API call duration, active sessions, and default
  process metrics.
- **Tracing**: the code is instrumented with the vendor-neutral OpenTelemetry
  **API** (each tool runs in a `tool:<name>` span). No SDK is bundled — enable
  real tracing at deploy with zero code changes:
  ```bash
  npm i -g @opentelemetry/auto-instrumentations-node   # in the runtime env
  NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register" \
  OTEL_EXPORTER_OTLP_ENDPOINT=https://collector:4318 OTEL_SERVICE_NAME=google-ads-mcp \
    node dist/server/http.js
  ```
- **Connection re-auth**: when Google rejects a connection's refresh token
  (`invalid_grant`), it is flagged `status = reauth_required` so an admin re-links
  it, instead of every call failing opaquely.
- **Key rotation**: generate a new `TOKEN_ENCRYPTION_KEY`, set the old key as
  `TOKEN_ENCRYPTION_KEY_PREVIOUS` (comma-separated, decrypt-only), then run
  `npm run rotate-key` (add `--dry-run` first) to re-encrypt every stored token
  under the new key. Afterwards drop the old key from `_PREVIOUS` and restart.
  New writes already use the new key; ciphertexts are versioned (`v1`/`v2`).
- **Backup/restore**: backups land in `./backups` (daily `pg_dump`, 14-day
  retention). Restore into a running Postgres with:
  ```bash
  gunzip -c ./backups/google_ads_mcp-<ts>.sql.gz \
    | docker compose -f docker-compose.prod.yml exec -T postgres \
        psql -U postgres -d google_ads_mcp
  ```
  Sync `./backups` off-site (S3/rsync) for real disaster recovery.

### Common failures

- **`/health/ready` returns 503 / "database: down"**: Postgres is unreachable or
  the pool is exhausted. Check `docker compose logs postgres`; verify
  `DATABASE_URL`; restart `postgres` then `mcp`.
- **Tools fail with auth errors for one client**: that connection's token was
  revoked (`status = reauth_required`) — have the owner re-link their MCC.
- **Google Ads calls intermittently fail**: transient 429/5xx are retried
  automatically; persistent 429 means you are hitting Google quota — slow the
  cadence, or raise `GOOGLE_ADS_API_MAX_RETRIES` cautiously.
- **The container will not come up**: usually a failed `prisma migrate deploy`
  (check `mcp` logs) or a fail-closed config error (missing `DATABASE_URL` /
  `BETTER_AUTH_SECRET` / `TOKEN_ENCRYPTION_KEY` / `BETTER_AUTH_URL`).
- **The server exits immediately with no output**: it printed the reason to
  stderr — a rejected env var, or an unknown `GOOGLE_ADS_TOOLSETS` group. MCP
  clients often hide stderr; run the same command in a terminal to see it.

---

## Security model

- **AuthN**: Better Auth (email+password **and** Google social SSO). MCP clients
  authenticate with a bearer token; web clients use cookies.
- **AuthZ**: role gate (`can(authCtx, tool)`) + per-account `AccountGrant`; write
  tools require a `WRITE`/`ADMIN` grant on the target account.
- **Secrets at rest**: refresh tokens encrypted with AES-256-GCM, AAD-bound to
  their connection row (a ciphertext cannot be swapped across tenants), with key
  rotation support (`TOKEN_ENCRYPTION_KEY` + `TOKEN_ENCRYPTION_KEY_PREVIOUS`).
- **Identity is never an argument.** It comes from the authenticated session
  (AsyncLocalStorage) and nowhere else. No tool schema exposes a user id, and any
  `userId` that arrives in arguments is dropped before a handler sees it.
- **Email**: transactional verification / password-reset / org-invitation emails
  via Resend, templated with React Email (`src/emails/`). Email verification is
  required automatically once a provider is configured.
- **Destructive guardrail**: `remove_*`/`delete_*`/`unlink_*`/`update_customer`
  require `confirm: true`. A global `GOOGLE_ADS_VALIDATE_ONLY` dry-run switch also
  exists.
- **GAQL input**: caller-supplied statements and clause fragments are both
  rejected if they carry statement separators or comment markers; fragments
  additionally reject statement keywords.
- **Audit**: every tool call by an authenticated org member is recorded
  (who/what/when/outcome) in `AuditLog`; readable via the admin `GET /audit`.

### Pre-launch security checklist

- [ ] `TOKEN_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` are fresh 32-byte randoms,
      stored only in `.env.prod` (never committed).
- [ ] `BETTER_AUTH_URL` is `https://` and `WEB_APP_ORIGIN` lists only real origins.
- [ ] `METRICS_TOKEN` set (or `/metrics` intentionally disabled); `/metrics` and
      `/audit` are not exposed publicly beyond the proxy.
- [ ] `TRUST_PROXY_HOPS` matches your proxy chain (never trust the whole chain).
- [ ] Backups verified restorable; `./backups` synced off-site.
- [ ] Single-operator credentials live in `~/.config/google-ads-mcp/.env`, not in
      a committed MCP client config.

---

## Environment variables

| Var | Required | Notes |
|-----|----------|-------|
| `GOOGLE_ADS_CLIENT_ID` / `_SECRET` / `_DEVELOPER_TOKEN` | yes | Google Ads API + Google social login |
| `GOOGLE_ADS_REFRESH_TOKEN` | stdio | Single-operator credentials. Either this or `DATABASE_URL` must be set |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | optional | Manager (MCC) id, dashes stripped |
| `DATABASE_URL` | HTTP | PostgreSQL connection string. Not needed for stdio |
| `GOOGLE_ADS_MCP_ENV` | optional | Path to the `.env` to load, ahead of `~/.config/google-ads-mcp/.env` |
| `GOOGLE_ADS_TOOLSETS` | optional | Comma-separated tool groups, or `all` (default `core,reporting`) |
| `GOOGLE_ADS_MAX_RESULT_CHARS` | optional | Ceiling on a single tool result (default 100000) |
| `TOKEN_ENCRYPTION_KEY` | yes (HTTP) | base64 that decodes to exactly 32 bytes — `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY_PREVIOUS` | optional | comma-separated old keys, decrypt-only (key rotation) |
| `BETTER_AUTH_SECRET` | yes (HTTP) | at least 32 chars — `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | yes (HTTP) | public base URL (https in prod), e.g. `https://mcp.agency.com` |
| `RESEND_API_KEY` | prod | Resend key; without it, verification/reset/invite emails are logged not sent |
| `EMAIL_FROM` | prod | sender, e.g. `Google Ads MCP <no-reply@agency.com>` |
| `EMAIL_VERIFICATION` | optional | `on`/`off`; defaults to on when a provider is configured |
| `WEB_APP_ORIGIN` | optional | your web app origin (CORS) |
| `TRUST_PROXY_HOPS` | optional | reverse-proxy hop count (default 1 = a single Caddy) |
| `GOOGLE_ADS_VALIDATE_ONLY` | optional | global dry-run: all mutations run validate-only |
| `GOOGLE_ADS_API_TIMEOUT_MS` | optional | per-attempt timeout for Google Ads API calls (default 60000) |
| `GOOGLE_ADS_API_MAX_RETRIES` | optional | retries on transient (429/5xx/UNAVAILABLE/network) failures (default 3) |
| `METRICS_TOKEN` | optional | bearer token for `GET /metrics`; unset = endpoint disabled (404) |
| `SESSION_TTL_MS` / `SESSION_SWEEP_MS` | optional | MCP session inactivity expiry / sweep interval (default 30m / 60s) |
| `MERCHANT_CENTER_ID`, `LOG_LEVEL` | optional | |

Register `${BETTER_AUTH_URL}/api/auth/callback/google` as an authorized redirect
URI in your Google Cloud OAuth client to enable Google social login.

---

## Local development

```bash
npm install
npm run typecheck && npm test                  # checks + unit tests

# stdio (single-operator), against your own .env:
npm run dev

# HTTP transport, needs Postgres:
docker compose up -d postgres                  # local Postgres on :5432
npx prisma migrate deploy                      # apply migrations
npm run http:dev                               # http://localhost:3000
```

Generate a single-operator refresh token with the loopback OAuth flow (it opens a
consent URL and writes `GOOGLE_ADS_REFRESH_TOKEN` to `.env`):

```bash
npm run generate-token
```

### Repository layout

- `src/createServer.ts` — builds the MCP server (tools + toolsets + RBAC + guardrails + audit).
- `src/index.ts` — stdio entry. `src/server/http.ts` — HTTP entry.
- `src/auth/betterAuth.ts` — Better Auth instance; `src/auth/identityContext.ts` — request identity (ALS).
- `src/policies/` — `rbac.ts` (roles), `destructive.ts` (confirmation),
  `resourceGuard.ts` (resourceName to customer), `gaql.ts` (GAQL guards + default
  LIMIT), `toolsets.ts` (tool groups).
- `src/services/` — `db.ts` (repositories, lazy Prisma), `crypto.ts` (token
  encryption), `email.ts` (Resend), Google Ads + Merchant Center clients.
- `src/tools/` — tool handlers by domain; `resourceReads.ts` and
  `resourceMutations.ts` generate the raw per-resource families.
- `src/emails/` — React Email templates. `src/test/harness.ts` — unit-test helpers.
- `packages/server/` — the dependency bundle + launcher for the multi-tenant HTTP mode.
- `prisma/schema.prisma` — data model. `docs/REPLATFORM.md` — re-platform runbook.

---

## Tests

```bash
npm test                 # vitest unit suite — 1009 tests, offline (mocks)
npm run coverage         # same + coverage; gated at 100% (statements/branches/funcs/lines)
npm run typecheck        # tsc --noEmit
```

Unit tests cover the executable logic (tools, services, policies, crypto, auth/
identity, config) at **100%**. Entry-point and side-effectful glue (`index.ts`,
`server/http.ts`, `createServer.ts`, `betterAuth.ts`, `emails/`, `logger.ts`) is
excluded from coverage and verified by the live smoke suites below instead.

Live smoke scripts (need a running Postgres; set `DATABASE_URL` + keys):

```bash
npx tsx scripts/smoke-db.ts        # repositories + encryption (AAD/v2) round-trip
npx tsx scripts/smoke-auth.ts      # Better Auth sign-up via the Prisma adapter
npx tsx scripts/smoke-identity.ts  # grant-gated access + anti-impersonation
npx tsx scripts/smoke-http.ts      # HTTP auth gate, tools/call, audit (server must run)
```

CI (`.github/workflows/ci.yml`) runs a dependency audit (fail on high/critical),
boots Postgres and runs migrations, typechecks, runs `npm run coverage` (100%
gate), builds, then runs all four smoke suites. Dependabot opens weekly update
PRs.

`npm audit` currently reports **zero** advisories at any severity. Two of them are
held there by path-scoped `overrides` (`deepmerge-ts` under `@prisma/config`,
`uuid` under `gaxios`) because upstream has no fixed release yet; re-check when
those packages publish.

### Load and performance

`scripts/load-test.js` is a [k6](https://k6.io) script (ramps to 50 VUs, fails on
readiness p95 > 500ms or any health-check error):

```bash
k6 run scripts/load-test.js                  # BASE defaults to :3939
TOKEN=<bearer> k6 run scripts/load-test.js   # also exercises authed tools/list
# quick local signal without k6:
npx autocannon -c 20 -d 10 http://localhost:3939/health/ready
```

Measured on a single Node process against Prisma Postgres (autocannon): `/healthz`
about 3.5k req/s (p99 230ms); `/health/ready` (DB-backed) about 240 req/s (p99
104ms), zero errors — the pg pool holds under sustained concurrency. Scale
horizontally behind Caddy for higher throughput.

---

## Skills

The `skills/` folder contains operational playbooks (`SKILL.md`) for skill-aware
agents — workflow guides, not MCP tools. See each folder for its objective and
guardrails.

## License

Source-available under the Sustainable Use License (SUL) v1.0 — see `LICENSE`.
Internal/personal/non-commercial use and modification allowed; commercial
redistribution/resale/sublicensing not granted.
