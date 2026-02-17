---
name: existing-account-rapid-audit-48h
description: 48-hour rapid diagnostic for existing Google Ads accounts. Use when a new client already has live campaigns and you need prioritized actions without waiting for a full audit cycle.
---

# existing-account-rapid-audit-48h

## Cadence
At onboarding for clients with an active account.

## Objective
Find the highest-impact fixes in the first 48 hours and create a ranked action backlog.

## Workflow
- Pull baseline performance for 30, 60, and 90 days by campaign, ad group, keyword, query, and device.
- Identify spend leaks: irrelevant search terms, weak match-type control, policy issues, and low-quality placements.
- Review campaign settings: network scope, geo, language, ad schedule, bid strategy, and budget constraints.
- Validate creative and asset coverage by ad strength, CTR trends, and message intent alignment.
- Compile quick wins (same day), short-term fixes (7 days), and structural changes (30 days).

## Core MCP Tools
- list_campaigns
- list_ad_groups
- list_keywords
- list_ads
- get_search_terms
- list_policy_findings
- get_change_history
- list_recommendations
- run_gaql_query
- list_conversion_actions

## Expected Outputs
- Audit scorecard with red and yellow flags
- Prioritized action backlog with estimated impact
- 48-hour quick-win execution list

## Guardrails
- Do not apply platform recommendations blindly.
- Preserve historical comparability when restructuring naming or grouping.
- Tag every proposed change with expected KPI impact.
