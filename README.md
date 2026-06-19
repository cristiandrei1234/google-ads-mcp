# Google Ads MCP

A **multi-tenant** Model Context Protocol server that exposes a large Google Ads
operations surface (reporting, campaign/ad group/keyword/ad lifecycle, audiences,
conversions, assets, Merchant Center, billing, recommendations, broad v23 parity)
to AI agents — built for a **marketing agency with employees**, each scoped to the
client accounts they're allowed to touch.

It runs as an HTTP service (Streamable HTTP MCP transport) behind authentication,
or as a local stdio server for single-operator development.

## Identity model

```
Agency MCC (admin)  ->  Employee MCC (per employee)  ->  Client accounts
```

- The agency is an **Organization**; employees are **Members** with roles
  (`owner`/`admin` = full, `member` = write, `viewer`/`analyst` = read-only).
- Each employee links their own Google account, producing a **GoogleAdsConnection**
  (their MCC + refresh token, **encrypted at rest**). The agency admin links the
  agency MCC (parent of the employee MCCs).
- An employee may operate on a client account only if they hold an **AccountGrant**
  for it (with `READ`/`WRITE`/`ADMIN` level). No grant ⇒ hard error.

Identity is resolved from the authenticated session (Better Auth) on every request
and is **never** taken from tool arguments — a client cannot impersonate another
tenant.

## Security model

- **AuthN**: Better Auth (email+password **and** Google social SSO). MCP clients
  authenticate with a bearer token; web clients use cookies.
- **AuthZ**: role gate (`can(authCtx, tool)`) + per-account `AccountGrant`; write
  tools require a `WRITE`/`ADMIN` grant on the target account.
- **Secrets at rest**: refresh tokens encrypted with AES-256-GCM, AAD-bound to
  their connection row (a ciphertext can't be swapped across tenants) with key
  rotation support (`TOKEN_ENCRYPTION_KEY` + `TOKEN_ENCRYPTION_KEY_PREVIOUS`).
- **Email**: transactional verification / password-reset / org-invitation emails
  via Resend, templated with React Email (`src/emails/`). Email verification is
  required automatically once a provider is configured.
- **Destructive guardrail**: `remove_*`/`delete_*`/`unlink_*`/`update_customer`/…
  require `confirm: true`. A global `GOOGLE_ADS_VALIDATE_ONLY` dry-run switch also
  exists.
- **Audit**: every tool call by an authenticated org member is recorded
  (who/what/when/outcome) in `AuditLog`; readable via the admin `GET /audit`.

## Repository layout

- `src/createServer.ts` — builds the MCP server (all tools + RBAC + guardrails + audit).
- `src/index.ts` — stdio entry (local dev). `src/server/http.ts` — HTTP entry (prod).
- `src/auth/betterAuth.ts` — Better Auth instance; `src/auth/identityContext.ts` — request identity (ALS).
- `src/policies/` — `rbac.ts` (roles), `destructive.ts` (confirmation),
  `resourceGuard.ts` (resourceName↔customer), `gaql.ts` (GAQL fragment guard).
- `src/services/` — `db.ts` (repositories), `crypto.ts` (token encryption),
  `email.ts` (Resend), Google Ads + Merchant Center clients.
- `src/emails/` — React Email templates. `src/tools/` — tool handlers by domain.
- `src/test/harness.ts` — unit-test helpers (captureTools/fakeCustomer).
- `prisma/schema.prisma` — data model. `docs/REPLATFORM.md` — re-platform runbook.

## Environment variables

The HTTP server fails closed at startup (`assertHttpServerConfig`) if the required
secrets are missing/invalid, so production never boots with a default key.

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `GOOGLE_ADS_CLIENT_ID` / `_SECRET` / `_DEVELOPER_TOKEN` | yes | Google Ads API + Google social login |
| `TOKEN_ENCRYPTION_KEY` | yes (HTTP) | base64 that decodes to exactly 32 bytes — `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY_PREVIOUS` | optional | comma-separated old keys, decrypt-only (key rotation) |
| `BETTER_AUTH_SECRET` | yes (HTTP) | ≥32 chars — `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | yes (HTTP) | public base URL (https in prod), e.g. `https://mcp.agency.com` |
| `RESEND_API_KEY` | prod | Resend key; without it, verification/reset/invite emails are logged not sent |
| `EMAIL_FROM` | prod | sender, e.g. `Google Ads MCP <no-reply@agency.com>` |
| `EMAIL_VERIFICATION` | optional | `on`/`off`; defaults to on when a provider is configured |
| `WEB_APP_ORIGIN` | optional | your web app origin (CORS) |
| `TRUST_PROXY_HOPS` | optional | reverse-proxy hop count (default 1 = a single Caddy) |
| `GOOGLE_ADS_REFRESH_TOKEN` / `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | optional | single-operator stdio fallback |
| `GOOGLE_ADS_VALIDATE_ONLY` | optional | global dry-run: all mutations run validate-only |
| `GOOGLE_ADS_API_TIMEOUT_MS` | optional | per-attempt timeout for Google Ads API calls (default 60000) |
| `GOOGLE_ADS_API_MAX_RETRIES` | optional | retries on transient (429/5xx/UNAVAILABLE/network) failures (default 3) |
| `METRICS_TOKEN` | optional | bearer token for `GET /metrics`; unset = endpoint disabled (404) |
| `SESSION_TTL_MS` / `SESSION_SWEEP_MS` | optional | MCP session inactivity expiry / sweep interval (default 30m / 60s) |
| `MERCHANT_CENTER_ID`, `LOG_LEVEL` | optional | |

Register `${BETTER_AUTH_URL}/api/auth/callback/google` as an authorized redirect
URI in your Google Cloud OAuth client to enable Google social login.

## Local development

```bash
npm install
docker compose up -d postgres                 # local Postgres on :5432
npx prisma migrate deploy                      # apply migrations
npm run typecheck && npm test                  # checks + unit tests

# HTTP server (production transport), local:
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/google_ads_mcp?schema=public"
npm run http:dev                               # http://localhost:3000

# or stdio (single-operator, no auth) for quick local use:
npm run dev
```

For single-operator mode you need a refresh token. Generate one with the loopback
OAuth flow (opens a consent URL, writes `GOOGLE_ADS_REFRESH_TOKEN` to `.env`):

```bash
npm run generate-token
```

## Production deploy (VPS + Docker + Caddy)

```bash
cp .env.prod.example .env.prod                 # fill DOMAIN, secrets, creds
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This runs Postgres (persistent volume + daily `pg_dump` backups), the MCP HTTP
server (auto-migrates on start), and Caddy (automatic Let's Encrypt TLS on
`$DOMAIN`, ports 80/443). DNS for `$DOMAIN` must point at the host.

## Connecting an MCP client

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
rollout — wiring is exercised by `smoke-auth`, but the IdP handshake is not.
**SCIM** (IdP-driven user provisioning) is not included; it is a separate
protocol build tracked as a roadmap item.

### Onboarding: connecting a Google Ads account
A signed-in member (agency owner or employee) links their own Google Ads account
via OAuth; the agency MCC and per-employee MCCs are both supported (one
`GoogleAdsConnection` per linked MCC, owned by the member).

```bash
# 1. Member opens this in a browser (auth-gated) -> Google consent (adwords scope):
GET  /connect/google-ads
#    Callback stores the encrypted refresh token + auto-detected login MCC, then
#    redirects to ${WEB_APP_ORIGIN}/connect/result?status=connected&mcc=...
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

## Operations runbook

- **Onboard an employee**: invite them to the organization (Better Auth
  `organization` plugin), they sign in, link their MCC, then an admin grants them
  the client accounts (`AccountGrant`).
- **Offboard**: ban/remove the member (Better Auth `admin`/`organization`); their
  grants and connections cascade.
- **Grant/revoke account access**: manage `AccountGrant` rows (admin tooling is a
  follow-up; see `docs/REPLATFORM.md`).
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
  it instead of every call failing opaquely.
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
  automatically; persistent 429 means you're hitting Google quota — slow the
  cadence or raise `GOOGLE_ADS_API_MAX_RETRIES` cautiously.
- **Container won't come up**: usually a failed `prisma migrate deploy` (check
  `mcp` logs) or a fail-closed config error (missing `BETTER_AUTH_SECRET` /
  `TOKEN_ENCRYPTION_KEY` / `BETTER_AUTH_URL`).

### Pre-launch security checklist
- [ ] `TOKEN_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` are fresh 32-byte randoms,
      stored only in `.env.prod` (never committed).
- [ ] `BETTER_AUTH_URL` is `https://` and `WEB_APP_ORIGIN` lists only real origins.
- [ ] `METRICS_TOKEN` set (or `/metrics` intentionally disabled); `/metrics` and
      `/audit` are not exposed publicly beyond the proxy.
- [ ] `TRUST_PROXY_HOPS` matches your proxy chain (never trust the whole chain).
- [ ] Backups verified restorable; `./backups` synced off-site.

### Dependency advisories
`npm audit` is clean of all directly-reachable issues. The remaining **5 moderate**
advisories are transitive and not reachable in our usage; fixing them needs a
breaking change or an upstream bump, so they are accepted and tracked:

- **`@hono/node-server`** (×3, via `@prisma/dev` → `prisma`): Prisma's local **dev
  server** (`prisma dev`). Production only runs `prisma migrate deploy` /
  `prisma generate`, so this code path never loads. Fix would downgrade Prisma 7→6.
- **`uuid <11.1.1`** (×2, via `gaxios` → `google-auth-library` → `google-ads-api`):
  bounds bug only when a `buf` argument is passed to v3/v5/v6 — gaxios does not.
  Resolves when google-ads-api bumps its gaxios.

Re-check after dependency upgrades with `npm audit`.

## Tests

```bash
npm test                 # vitest unit suite — 944 tests, offline (mocks)
npm run coverage         # same + coverage; gated at 100% (statements/branches/funcs/lines)
npm run typecheck        # tsc --noEmit
```

Unit tests cover the executable logic (tools, services, policies, crypto, auth/
identity, config) at **100%**. Entry-point/side-effectful glue (`index.ts`,
`server/http.ts`, `createServer.ts`, `betterAuth.ts`, `emails/`, `logger.ts`) is
excluded from coverage and verified by the live smoke suites below instead.

Live smoke scripts (need a running Postgres; set `DATABASE_URL` + keys):

```bash
npx tsx scripts/smoke-db.ts        # repositories + encryption (AAD/v2) round-trip
npx tsx scripts/smoke-auth.ts      # Better Auth sign-up via the Prisma adapter
npx tsx scripts/smoke-identity.ts  # grant-gated access + anti-impersonation
npx tsx scripts/smoke-http.ts      # HTTP auth gate → tools/call → audit (server must run)
```

CI (`.github/workflows/ci.yml`) runs a dependency audit (fail on high/critical) →
boots Postgres and runs migrations → typecheck → `npm run coverage` (100% gate) →
build → all four smoke suites. Dependabot opens weekly update PRs.

### Load & performance
`scripts/load-test.js` is a [k6](https://k6.io) script (ramps to 50 VUs, fails on
readiness p95 > 500ms or any health-check error):

```bash
k6 run scripts/load-test.js                  # BASE defaults to :3939
TOKEN=<bearer> k6 run scripts/load-test.js   # also exercises authed tools/list
# quick local signal without k6:
npx autocannon -c 20 -d 10 http://localhost:3939/health/ready
```

Measured on a single Node process against Prisma Postgres (autocannon): `/healthz`
~3.5k req/s (p99 230ms); `/health/ready` (DB-backed) ~240 req/s (p99 104ms), zero
errors — the pg pool holds under sustained concurrency. Scale horizontally behind
Caddy for higher throughput.

## Skills

The `skills/` folder contains operational playbooks (`SKILL.md`) for skill-aware
agents — workflow guides, not MCP tools. See each folder for its objective and guardrails.

## License

Source-available under the Sustainable Use License (SUL) v1.0 — see `LICENSE`.
Internal/personal/non-commercial use and modification allowed; commercial
redistribution/resale/sublicensing not granted.
