# Plan: Automwise Google Ads plugin — individual MCP + all skills

## Requested outcome

One plugin product, installable in **both ChatGPT and Codex Desktop/CLI**,
containing the existing individual Google Ads MCP (**345 local tools**) and
**all 39 existing skills**. Include app integration if supported and useful for
that host. Installing the package should expose the workflows without manually
copying skills or registering each one separately.

This is a plan, not an implemented plugin package. No production server deployment
is part of this clarified request. Existing local/server OAuth fixes remain in
the release branch.

## Verified inventory

The local `dist/index.js` was started through the MCP SDK's stdio client with
isolated fixture credentials, `GOOGLE_ADS_TOOLSETS=all` and no database. Its
`tools/list` returned **345 tools**. No live Google Ads operations were performed.
The repository contains **39** `skills/<name>/SKILL.md` files.

The root npm package currently includes `dist` and `prisma`, not `skills`.
A public registry lookup for `@automwise/google-ads-mcp` returned 404 in this
session. The plugin must explicitly include the skills, and its launcher must
use a verified distributable artifact/version rather than assuming that the
README's `npx` package is already publicly installable.

All explicitly listed core tools were compared with that live local catalog.
Three skills contain organization-only tool dependencies:

| Skill | Tools unavailable in local mode | Planned local adaptation |
| --- | --- | --- |
| access-billing-permission-validator | get_user_status, list_user_linked_accounts, select_user_accounts, set_default_user_account | Discover permitted Google Ads customers via the actual local account-discovery tools; use explicit customer/MCC selection; separate billing/Google permissions from organization roles |
| account-connection-and-verification-ops | disconnect_user_account | Treat local refresh-token revocation/replacement and client restart as operator steps; keep supported advertiser verification operations |
| client-intake-and-goal-mapper | get_user_status, list_user_linked_accounts | Discover permitted customers locally and collect business goals; do not assume an organization user record |

Keep the organization workflows available when that backend is configured.
Do not claim those organization-only tools exist in individual stdio mode.

## 1. Confirm the plugin host and official package format

Requested reference: https://learn.chatgpt.com/docs/build-plugins

Plugin Creator is not exposed in this conversation's installed skills/tools.
Fetching the reference from this environment returns HTTP 403. Therefore the
manifest layout, app declarations, installation rules and hosted execution
capabilities are **not yet verified**. Read the guide through an accessible
session and use Plugin Creator before generating those platform-specific files.

Confirm these points first:

- The requested targets are both ChatGPT and Codex Desktop/CLI: confirm the
  package/install requirements independently for each.
- Can that host start a local Node/stdio MCP, or does its app interface require a
  reachable hosted service? Plugin packaging alone does not answer this question.
- Can skills, MCP configuration and app references coexist in one package, and
  what is the supported metadata/configuration schema?
- How are OAuth and secrets configured outside the package? What are the supported
  developer install, validator and private distribution paths?

**Runtime decision:** where local stdio is supported, use the existing individual
MCP directly. If a host requires remote app/MCP calls, a running service remains
necessary; do not promise that including the Node package makes it run on the
provider's infrastructure. Discuss that runtime choice before implementing a
hosted adapter. Do not assume the legacy ChatGPT plugin manifest/OpenAPI format.

### Both-host delivery strategy

Maintain one shared skill collection and the existing MCP implementation. Add
host-specific configuration/adapters only where the official formats differ.
Provide two install paths and verify each independently; do not assume that one
archive/configuration is accepted by both hosts.

| Host | Proposed integration | Must confirm before implementation |
| --- | --- | --- |
| Codex Desktop/CLI | Individual Node MCP via stdio plus all skills | Official plugin packaging, local process launch, credentials/config path and skill discovery |
| ChatGPT | All skills plus the platform-supported app/MCP integration | Whether this host supports local stdio, a hosted endpoint, or another supported runtime; exact app/OAuth/package declarations |

If ChatGPT requires a hosted endpoint, keep a hosted adapter as an explicit
additional runtime. The individual Codex path must continue to work without an
organization database/server. Support all 345 local tools through compatible
tool registration; the 39 skills are workflows above those tools, not 345
separate skill files.

## 2. Assemble the package around the existing code

Use the official format confirmed above. The logical contents are:

- Name, description, version, icon and capability metadata.
- All 39 skills, registered as independently discoverable workflows.
- A concise entry/routing skill that selects relevant workflows by intent instead
  of loading every skill body into each request. Keep existing skill names where
  the platform permits them.
- MCP launch/integration configuration pointing to a verified, pinned
  distributable artifact of the existing Node package; use stdio for the individual runtime where supported.
- An optional app reference/integration for hosts that require or support it;
  this does not replace the skills or implicitly host the MCP process.
- Installation, account connection, token troubleshooting and uninstall docs.

Avoid a duplicate implementation of the Google Ads API. Keep credentials in the
selected user configuration/host credential store, never in plugin artifacts.
The existing local refresh fix already aligns `generate-token`, `check-token`
and the server's configuration path. Google OAuth Testing can still expire
refresh tokens after seven days; document In production and token regeneration.

## 3. Adapt skills to the individual runtime

Keep every existing skill in the package. Update the three compatibility cases
above with explicit local and organization routes. Audit every skill's actual
workflow, permissions, input/output claims and tool names before publishing.

Define a consistent start: discover accessible accounts, choose the correct
customer/MCC, confirm currency/reporting timezone, then fetch source metrics.
Handle absent data and conversion lag explicitly. For writes, present the exact
account/change, respect the user's authorized scope, use validate-only where
supported, and retain destructive confirmation checks. In local mode there is
no organization RBAC boundary; access comes from the Google credential and the
operator's explicit instructions.

## 4. Make all tool groups reachable without flooding context

All 39 skills need more than the default `core,reporting` toolsets. Map each skill
reference to its tool group and include that dependency in routing instructions.
Test dynamic toolsets/`enable_toolset` with the actual plugin host before relying
on list-change notifications. For hosts that do not support dynamic discovery,
provide a documented compatible registration configuration, including `all`
where necessary. Packaging all skills must not leave their tools unavailable.

## 5. Validate installation and workflows

Use the official validator/install flow once confirmed. Verify:

1. Clean installation discovers every one of the 39 skills and the MCP endpoint.
2. Local launch works without Postgres or organization authentication, where
   local stdio is supported. Use the user's selected config file consistently.
3. Every referenced tool exists for the selected runtime, or the workflow routes
   to a documented operator action; no phantom organization tools.
4. Reports, audit, planning, Shopping/assets and lifecycle operations select the
   required tool groups. Keep Merchant Center's separate configuration explicit.
5. Access-token renewal works without a browser; invalid/revoked Google refresh
   tokens show the correct recovery steps without logging credentials.
6. Read workflows never perform incidental writes. Mutation workflows preserve
   requested limits, validate-only behavior and destructive confirmation.
7. A pinned upgrade preserves credentials/configuration. Uninstall removes the
   package without revoking or deleting the operator's account implicitly.

Use offline fixtures for catalog/schema checks, then a dedicated Google Ads test
account for real reads and validate-only operations. Live campaign changes are
not needed to prove that the initial package is installable.

## 6. Deliver and privately install

Deliver the complete package, per-host installation instructions, compatibility
matrix and validation results. Install privately for the owner first. Public
listing, a hosted adapter, or scheduled jobs are separate follow-up scope unless
the official host supports them and the owner requests them. A skill named
"daily" or "weekly" does not by itself schedule unattended execution.

## Complete skill inventory

| # | Existing skill | Local tool-reference check |
| --- | --- | --- |
| 1 | access-billing-permission-validator | Adapt organization dependencies |
| 2 | account-connection-and-verification-ops | Adapt organization dependencies |
| 3 | ad-copy-refresh-assistant | Listed tools present |
| 4 | asset-sets-and-signals-ops | Listed tools present |
| 5 | assets-and-pmax-linking-ops | Listed tools present |
| 6 | audience-targeting-advanced-ops | Listed tools present |
| 7 | bidding-portfolio-and-adjustments-ops | Listed tools present |
| 8 | campaign-adgroup-ad-keyword-lifecycle-ops | Listed tools present |
| 9 | campaign-drafts-and-experiments-ops | Listed tools present |
| 10 | client-intake-and-goal-mapper | Adapt organization dependencies |
| 11 | conversion-goals-offline-data-and-customer-match-ops | Listed tools present |
| 12 | daily-bid-floor-ceiling-check | Listed tools present |
| 13 | daily-budget-pacing-guard | Listed tools present |
| 14 | daily-performance-anomaly-detector | Listed tools present |
| 15 | daily-policy-and-delivery-check | Listed tools present |
| 16 | daily-search-terms-hygiene | Listed tools present |
| 17 | device-profit-split-planner | Listed tools present |
| 18 | existing-account-rapid-audit-48h | Listed tools present |
| 19 | first-30-days-stabilization-playbook | Listed tools present |
| 20 | first-campaign-structure-and-launch-checklist | Listed tools present |
| 21 | greenfield-account-setup-blueprint | Listed tools present |
| 22 | greenfield-market-research | Listed tools present |
| 23 | keyword-planner-budget-forecaster | Listed tools present |
| 24 | landing-intent-mismatch-checker | Listed tools present |
| 25 | merchant-shopping-hotel-and-local-services-ops | Listed tools present |
| 26 | monthly-client-report-pack | Listed tools present |
| 27 | monthly-goal-vs-actual | Listed tools present |
| 28 | monthly-growth-opportunities | Listed tools present |
| 29 | monthly-structure-review | Listed tools present |
| 30 | negative-conflict-checker | Listed tools present |
| 31 | negative-keyword-and-customer-negative-governance-ops | Listed tools present |
| 32 | query-to-keyword-promoter | Listed tools present |
| 33 | recommendations-and-batch-jobs-ops | Listed tools present |
| 34 | tracking-conversion-readiness-check | Listed tools present |
| 35 | weekly-account-health-report | Listed tools present |
| 36 | weekly-audience-cleanup | Listed tools present |
| 37 | weekly-budget-reallocation | Listed tools present |
| 38 | weekly-change-log-auditor | Listed tools present |
| 39 | weekly-experiment-planner | Listed tools present |
