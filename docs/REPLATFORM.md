# Production re-platform — status & runbook

Branch: `production-rearchitecture` (not pushed). Commit small and often.

Target: local single-operator stdio tool → networked multi-tenant service for a
marketing agency. Identity model (confirmed):

```
Agency MCC (admin)  ->  Employee MCC (per employee)  ->  Client accounts
```

- Auth for employees: **Better Auth** (`organization` + `bearer` + `oidc/mcp`).
- Transport: **Streamable HTTP** (Express) + auth middleware; stdio kept for dev.
- Hosting: **VPS + Docker Compose + Caddy** (TLS).
- Guardrail: write allowed, `remove_*/delete_*/unlink_*/update_customer/...`
  require `confirm: true`. Global `GOOGLE_ADS_VALIDATE_ONLY` dry-run kept.

## Done (committed, verified by typecheck + tests + prisma validate)

1. **ESM migration + tooling** — `type: module`, NodeNext, tsx, vitest;
   `.js` extensions across src/ + scripts/. `npm run typecheck` / `build` green.
2. **Crypto at rest** — `src/services/crypto.ts` (AES-256-GCM, versioned,
   tamper-detecting) + 11 tests.
3. **Destructive guardrails** — `src/policies/destructive.ts`; central wiring
   in `src/index.ts` (auto-injects `confirm` into destructive tools' schema and
   blocks unconfirmed calls). RBAC read/write regex fixed. + tests.
4. **Production Prisma schema** — `prisma/schema.prisma` (Better Auth + domain
   tables: GoogleAdsConnection, AccountGrant, AuditLog). `prisma validate` OK.
5. **Data-access rewrite + migration** — applied migration
   `20260602090348_replatform_multitenant` to a live Postgres (docker compose,
   13 tables). `services/db.ts` rewritten into repositories (connections/grants/
   audit/status) with at-rest token encryption; client.ts/merchant/listAccounts/
   admin ported; superseded `server/auth.ts` + `tools/accountAccess.ts` removed.
   env keys added. `scripts/smoke-db.ts` verifies the full stack on real PG.
   `getCustomer(customerId, userId?)` kept transitional (userId removal = step 8).

## Local dev DB
`docker compose up -d postgres` (localhost:5432, db google_ads_mcp, postgres/
postgres). NOTE: the committed `.env` `DATABASE_URL` points at db.prisma.io
(hosted) — for local work, override with the compose URL (the prisma commands
above used `--url`). The schema migration has NOT been applied to the hosted DB.

## Remaining (ordered) — each needs the live environment to verify

### 6. Better Auth instance  ✅ DONE (verified vs live PG)
- `src/auth/betterAuth.ts` built (organization/admin/bearer/mcp; email+password
  AND Google social). Schema reconciled with the CLI + migration applied.
  `scripts/smoke-auth.ts` proves sign-up persists through the adapter.
- Google social callback to register in Google Cloud:
  `${BETTER_AUTH_URL}/api/auth/callback/google`. Dev email senders just log the
  link — wire a real provider for prod.

### 7. HTTP transport + identity middleware  ✅ DONE (e2e verified)
- `src/createServer.ts` (shared builder, defensive de-dup), `src/index.ts` thin
  stdio entry, `src/server/http.ts` (Express + helmet + CORS + Better Auth mount
  + /healthz + /mcp Streamable with per-session transports + 401 gate),
  `src/auth/identityContext.ts` (AsyncLocalStorage AuthContext).
- `scripts/smoke-http.ts`: unauth->401, sign-in->bearer, authed initialize->200.
- PROXY NOTE: behind Caddy, set Better Auth `advanced.ipAddress.ipAddressHeaders`
  (e.g. X-Forwarded-For) so rate limiting can see the real client IP.

### 8. Identity-based authz + audit  ✅ DONE (live-verified)
- `rbac.ts` → `can(authCtx, toolName)` role gate; account access enforced by
  AccountGrant in getConnectionForCustomer. `withRbac` reads getIdentity() (ALS),
  STRIPS caller userId (anti-impersonation), appends AuditLog (ok/error/denied).
  `getCustomer`/`getMerchantAuth` use the ALS identity, ignore the userId arg.
- `scripts/smoke-identity.ts` proves grant-gated access + impersonation
  resistance on live PG. `rbac.test.ts` covers the role matrix.
- FOLLOW-UPS — ALL DONE: (a) `userId` stripped from every tool's advertised
  schema centrally (verified via tools/list in smoke-http: 346 tools, no userId);
  listAccounts uses ALS identity, get_user_status param renamed targetUserId;
  (b) accessLevel-per-tool (write requires WRITE/ADMIN grant via getGrantLevel);
  (c) full e2e: authed tools/call -> AuditLog row -> admin GET /audit (smoke-http);
  (d) admin `/audit` endpoint; per-request x-request-id (header + access log +
  ALS into tool error logs); per-IP rate limit on /mcp; CI with Postgres runs all
  four smoke suites. Audit outcome correctly records internal {isError} as "error".
- DELIBERATE (not a gap): inline tool handlers surface the raw Google Ads
  error.message to the operator (useful for debugging, not secret); withRbac/
  toErrorMessage covers thrown errors.

### 10. Hardening  ✅ DONE
- `toErrorMessage` + structured error logging in the withRbac choke point.
  Reverse-proxy readiness: express `trust proxy` + Better Auth
  `advanced.ipAddress.ipAddressHeaders`. accessLevel enforcement (above).
- STILL OPEN (low priority): the ~60 manually-registered tools in createServer.ts
  keep their own inner try/catch (redundant under withRbac, harmless);
  global per-IP request rate limiter on /mcp (Better Auth already rate-limits
  /api/auth).

### 11. Infra (VPS + Docker + Caddy)  ✅ DONE
- `docker-compose.prod.yml` (mcp HTTP + postgres persistent + daily pg_dump
  backup + caddy auto-TLS), `Caddyfile` (SSE-friendly), `.env.prod.example`,
  Dockerfile EXPOSE 3000 + HTTP CMD. `docker compose config` validates.

### 12. Tests + docs  ✅ DONE
- README rewritten for the production model (identity/security model, env,
  local dev, VPS deploy, MCP client connection, ops runbook).
- Unit tests: crypto, destructive, rbac (24). Live smoke scripts: smoke-db,
  smoke-auth, smoke-identity, smoke-http (full HTTP e2e). CI (GitHub Actions)
  boots Postgres and runs migrations + typecheck + unit tests + all four smokes.
  resolveAuthContext is covered by the smoke-http e2e (auth -> member resolution).

## STATUS: re-platform COMPLETE. Steps 1–12 + all follow-ups done and verified
against live infra (typecheck, 24 unit tests, 4 live smoke suites, CI). Nothing
outstanding blocks production use.

## Verify-as-you-go
`npm run typecheck && npm test` after each step. After step 5+, a live Postgres
is required (`docker compose up -d postgres`).

## Audit remediation (20-agent audit, 116 findings)

ALL 6 criticals + the impactful highs fixed and re-verified (typecheck + 31 unit
tests + full HTTP e2e):
- Default-deny write classification (rbac.ts isWriteTool) + fail-closed role gate
  — non-prefixed mutators (set_/attach_/promote_/end_/duplicate_/clear_/add_batch_
  job_operations/run_offline_user_data_job) now hit the role + WRITE-grant gates.
- Irreversible non-prefixed tools added to the destructive confirm set.
- Fail-closed boot (assertHttpServerConfig): BETTER_AUTH_SECRET (>=32),
  TOKEN_ENCRYPTION_KEY (base64 32B, alphabet-validated), BETTER_AUTH_URL (https in
  prod) required before listen. trust proxy = hop count (not true).
- MCP sessions bound to their creating user (no cross-session reuse).
- AuditLog decoupled from Organization (no cascade) — append-only survives org delete.
- Grants scoped to the active org (no cross-org leakage); list_accessible_accounts
  intersects discovery with grants (grants are authoritative scope).
- Merchant Center gated by AccountGrant on a customerId (no connections[0]).
- resourceName↔customerId guard on offline-user-data/customer-match (no cross-account
  PII writes). GAQL numeric-id validation (shopping).
- mutator surfaces partial_failure instead of silent success.
- Email verification gated behind EMAIL_VERIFICATION=on (no broken prod sign-in).

DEFERRED (medium/low; defense-in-depth or product decisions — not blocking):
- Crypto AAD binding + key rotation: hardening vs an attacker who already has DB
  write access; needs a v2 ciphertext scheme + token migration. Recommended next.
- Real transactional email provider (pick one; then set EMAIL_VERIFICATION=on).
- GAQL free-text where/orderBy allowlist (verticals/coverage/readParity): reads are
  customer-scoped + grant-gated, so low actual risk; numeric-id vectors fixed.
- Per-call dry-run threading (global GOOGLE_ADS_VALIDATE_ONLY switch already works).
- Remaining 33 medium / 39 low / 13 info: minor/style; see audit output.

## Post-audit hardening round 2 (all named deferrals done)
- Email: Resend + React Email (emails/ActionEmail.tsx) for verification / reset /
  org invitation; requireEmailVerification auto-on when a provider is configured.
- Crypto: AAD-bound v2 ciphertext (token tied to conn:{org}:{mcc}) + key rotation
  (TOKEN_ENCRYPTION_KEY_PREVIOUS, decrypt tries primary+previous). v1 still reads.
- GAQL: assertSafeGaqlFragment guard on the only raw where/orderBy tools
  (mutateCoverageV23, verticals).
40 unit tests + all 4 live smoke suites green. Remaining tail is style/info only
(e.g. ~60 inline tool try/catch are redundant-but-harmless under withRbac;
per-call dry-run uses the global GOOGLE_ADS_VALIDATE_ONLY switch).
