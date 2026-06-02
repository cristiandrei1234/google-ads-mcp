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

## Operations runbook

- **Onboard an employee**: invite them to the organization (Better Auth
  `organization` plugin), they sign in, link their MCC, then an admin grants them
  the client accounts (`AccountGrant`).
- **Offboard**: ban/remove the member (Better Auth `admin`/`organization`); their
  grants and connections cascade.
- **Grant/revoke account access**: manage `AccountGrant` rows (admin tooling is a
  follow-up; see `docs/REPLATFORM.md`).
- **Audit**: `GET /audit?limit=100[&customerId=...]` (org admin only).
- **Key rotation**: generate a new `TOKEN_ENCRYPTION_KEY`, move the old key into
  `TOKEN_ENCRYPTION_KEY_PREVIOUS` (comma-separated, decrypt-only). New writes use
  the new key; existing tokens still decrypt via the previous key and are
  re-encrypted on next write. Ciphertexts are versioned (`v1`/`v2`).
- **Backup/restore**: backups land in `./backups`; restore with
  `gunzip -c <file>.sql.gz | psql ...`. Sync `./backups` off-site for real DR.

## Tests

```bash
npm test                 # vitest unit suite — 859 tests, offline (mocks)
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

CI (`.github/workflows/ci.yml`) boots Postgres and runs migrations → typecheck →
`npm run coverage` (100% gate) → build → all four smoke suites.

## Skills

The `skills/` folder contains operational playbooks (`SKILL.md`) for skill-aware
agents — workflow guides, not MCP tools. See each folder for its objective and guardrails.

## License

Source-available under the Sustainable Use License (SUL) v1.0 — see `LICENSE`.
Internal/personal/non-commercial use and modification allowed; commercial
redistribution/resale/sublicensing not granted.
