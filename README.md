# Google Ads MCP

Google Ads MCP is a local MCP server (stdio transport) that exposes a large Google Ads operations surface: reporting, campaign/ad group/keyword lifecycle, audiences, conversions, assets, Merchant Center, billing, recommendations, and broad v23 parity coverage.

It also includes an optional OAuth helper server for multi-user flows, plus 39 operational playbook skills under `skills/`.

## What Is Implemented

- MCP server over stdio in `src/index.ts`.
- PostgreSQL + Prisma persistence for users, refresh tokens, and account associations.
- Multi-tenant access control hooks (RBAC gate before tool handlers).
- OAuth helper server in `src/server/auth.ts` for account linking and account selection.
- Broad tool coverage across Google Ads domains (core + advanced + parity families).
- Dockerized local run (`Dockerfile`, `docker-compose.yml`) for Postgres + MCP.

### Tool Families (High-Level)

- Account and access: `list_accessible_accounts`, account-access helpers, admin status.
- Core delivery objects: campaigns, ad groups, keywords, ads, assets.
- Negatives and shared lists: ad group/campaign negatives and shared negative keyword lists.
- Audience and measurement: user lists, custom/combined audiences, conversion actions, conversion goals, offline uploads, customer match.
- Planning and optimization: keyword planner, recommendations, experiments, campaign drafts, bidding advanced.
- Commerce and verticals: Merchant Center products and linking, Shopping/PMax reads, hotel/local-services/audience-insights reads.
- Billing and compliance: invoices, account budgets, billing setups, policy findings, identity verification.
- Bulk operations: batch jobs and large mutate families via v23 parity tooling.

## Repository Layout

- `src/index.ts`: main MCP server (stdio transport).
- `src/server/auth.ts`: OAuth helper server (`/login`, `/oauth2callback`, user account selection endpoints).
- `src/tools/`: tool handlers grouped by Google Ads domain.
- `src/services/`: Google Ads clients, Merchant Center client, DB adapter.
- `src/policies/rbac.ts`: account-level permission guard.
- `prisma/schema.prisma`: DB schema.
- `skills/`: operational playbooks (`SKILL.md` files).
- `scripts/`: utility scripts (token generation, integration checks).

## Prerequisites

- Node.js 20+ recommended.
- npm.
- PostgreSQL (local or hosted).
- Docker + Docker Compose plugin (optional, recommended for local stack).
- Google Ads API credentials (developer token + OAuth client).

## Environment Variables

Copy `.env.example` to `.env` and fill values:

```bash
cp .env.example .env
```

Required:

- `DATABASE_URL`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`

Optional:

- `GOOGLE_ADS_REFRESH_TOKEN` (single-user fallback mode)
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `MERCHANT_CENTER_ID`
- `LOG_LEVEL` (`debug|info|warn|error`, default `info`)

## Local Run (Node.js)

1. Install dependencies:

```bash
npm install
```

2. Run DB migrations:

```bash
npx prisma migrate deploy
```

3. Build and start MCP:

```bash
npm run build
npm start
```

Development mode:

```bash
npm run dev
```

## Local Run (Docker Compose)

1. Build MCP image:

```bash
docker compose build mcp
```

2. Start Postgres:

```bash
docker compose up -d postgres
```

3. Run MCP on stdio:

```bash
docker compose run --rm -i mcp
```

Notes:

- Compose overrides `DATABASE_URL` to `postgresql://postgres:postgres@postgres:5432/google_ads_mcp?schema=public`.
- Container startup runs `prisma migrate deploy` before launching MCP.
- Stop local stack:

```bash
docker compose down
```

## Authentication Modes

### Mode A: Single-User (Static Refresh Token)

Use `GOOGLE_ADS_REFRESH_TOKEN` in `.env`.

Good for:

- local testing
- one operator / one credential

### Mode B: Multi-User OAuth (Recommended)

Run auth server:

```bash
npm run auth-server
```

Flow:

1. Open `http://localhost:3000/login`.
2. Complete Google OAuth consent.
3. Server stores user refresh token in DB and discovers linked accounts.
4. Use:
   - `GET /users/:userId/accounts`
   - `POST /users/:userId/accounts/select` with `{"customerIds":["1234567890"]}`
5. Pass `userId` in MCP tool calls that support tenant context.

## Skills

The `skills/` folder contains **39 operational playbooks**.  
Each skill is a folder with a `SKILL.md` (name, objective, workflow, core tools, guardrails).

These are not MCP tools by themselves; they are workflow guides intended for skill-aware agents.

### Included Skills (39)

- `access-billing-permission-validator`
- `account-connection-and-verification-ops`
- `ad-copy-refresh-assistant`
- `asset-sets-and-signals-ops`
- `assets-and-pmax-linking-ops`
- `audience-targeting-advanced-ops`
- `bidding-portfolio-and-adjustments-ops`
- `campaign-adgroup-ad-keyword-lifecycle-ops`
- `campaign-drafts-and-experiments-ops`
- `client-intake-and-goal-mapper`
- `conversion-goals-offline-data-and-customer-match-ops`
- `daily-bid-floor-ceiling-check`
- `daily-budget-pacing-guard`
- `daily-performance-anomaly-detector`
- `daily-policy-and-delivery-check`
- `daily-search-terms-hygiene`
- `device-profit-split-planner`
- `existing-account-rapid-audit-48h`
- `first-30-days-stabilization-playbook`
- `first-campaign-structure-and-launch-checklist`
- `greenfield-account-setup-blueprint`
- `greenfield-market-research`
- `keyword-planner-budget-forecaster`
- `landing-intent-mismatch-checker`
- `merchant-shopping-hotel-and-local-services-ops`
- `monthly-client-report-pack`
- `monthly-goal-vs-actual`
- `monthly-growth-opportunities`
- `monthly-structure-review`
- `negative-conflict-checker`
- `negative-keyword-and-customer-negative-governance-ops`
- `query-to-keyword-promoter`
- `recommendations-and-batch-jobs-ops`
- `tracking-conversion-readiness-check`
- `weekly-account-health-report`
- `weekly-audience-cleanup`
- `weekly-budget-reallocation`
- `weekly-change-log-auditor`
- `weekly-experiment-planner`

### How To Install Skills

#### For Codex-style skill systems (`$CODEX_HOME/skills`)

Install one skill:

```bash
mkdir -p "$CODEX_HOME/skills"
cp -R skills/weekly-account-health-report "$CODEX_HOME/skills/"
```

Install all skills:

```bash
mkdir -p "$CODEX_HOME/skills"
cp -R skills/* "$CODEX_HOME/skills/"
```

Windows PowerShell example:

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.codex\\skills" | Out-Null
Copy-Item -Recurse .\\skills\\* "$env:USERPROFILE\\.codex\\skills\\"
```

If your agent does not support `SKILL.md` natively, use these files as reusable operational prompt templates.

## Connect To Claude

This server already uses stdio transport, so Claude clients that support stdio MCP can connect directly.

### Option A: Run via Docker from Claude config

Use your client MCP config and add:

```json
{
  "mcpServers": {
    "google-ads-mcp": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "compose",
        "-f",
        "C:\\\\ABSOLUTE\\\\PATH\\\\TO\\\\google-ads-mcp\\\\docker-compose.yml",
        "run",
        "--rm",
        "-i",
        "mcp"
      ]
    }
  }
}
```

### Option B: Run Node build directly

1. Build once:

```bash
npm run build
```

2. MCP config example:

```json
{
  "mcpServers": {
    "google-ads-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\\\ABSOLUTE\\\\PATH\\\\TO\\\\google-ads-mcp\\\\dist\\\\index.js"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/google_ads_mcp?schema=public",
        "GOOGLE_ADS_CLIENT_ID": "your_client_id",
        "GOOGLE_ADS_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_ADS_DEVELOPER_TOKEN": "your_developer_token",
        "GOOGLE_ADS_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

## Connect To GPT

There are two GPT paths, and they are different in practice:

### Path 1: OpenAI Agents SDK (local stdio supported)

OpenAI Agents SDK docs indicate MCP over stdio is supported for local servers, which matches this repository architecture.

### Path 2: ChatGPT / Remote MCP integrations

OpenAI MCP docs describe remote MCP integration via SSE/HTTP URL (`server_url`) for ChatGPT-oriented integrations.  
This repository currently exposes stdio transport only, so direct ChatGPT remote integration requires an adapter or adding a remote MCP transport layer.

If you want native ChatGPT remote connection from this repo, next step is adding Streamable HTTP/SSE transport to the server.

## Useful Scripts

- `npm run build`: compile TypeScript.
- `npm start`: run compiled MCP server (`dist/index.js`).
- `npm run dev`: run MCP with ts-node.
- `npm run auth-server`: run OAuth helper server.
- `npm run generate-token`: helper script for refresh-token generation.
- `npm run test:all-tools`: integration script for tool coverage checks.

## Troubleshooting

- `DATABASE_URL must be a PostgreSQL connection string`:
  Use `postgresql://` or `postgres://`, SQLite is not supported by current env validation.
- OAuth returns no refresh token:
  Re-consent with `prompt=consent` and ensure prior grant is revoked if needed.
- `DEVELOPER_TOKEN_NOT_APPROVED` / `USER_PERMISSION_DENIED`:
  Check Ads API token approval state and account-level permissions.
- Merchant Center calls fail:
  Validate Merchant Center permissions and `MERCHANT_CENTER_ID`.

## References

- Anthropic MCP docs: https://docs.anthropic.com/en/docs/claude-code/mcp
- OpenAI MCP overview: https://platform.openai.com/docs/mcp
- OpenAI Developer Mode MCP guide: https://platform.openai.com/docs/guides/developer-mode
- OpenAI Agents SDK MCP docs: https://openai.github.io/openai-agents-python/mcp/
