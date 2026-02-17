---
name: first-30-days-stabilization-playbook
description: First 30-day stabilization routine after a new launch or account takeover. Use for both existing and greenfield clients to control waste, improve signal quality, and establish optimization rhythm.
---

# first-30-days-stabilization-playbook

## Cadence
Daily in week 1-2, then 3 times per week in week 3-4.

## Objective
Stabilize spend efficiency and conversion signal quality during the learning phase.

## Workflow
- Monitor spend, clicks, and conversion drift by campaign and device against planned ranges.
- Run daily search-term hygiene: add negatives and promote high-intent terms into controlled keyword sets.
- Pause or bid-adjust weak entities based on minimum data thresholds.
- Resolve policy findings and monitor delivery limitations.
- Track every change in a compact changelog to avoid overlapping edits.

## Core MCP Tools
- get_search_terms
- list_keywords
- bulk_update_keywords
- pause_keyword
- enable_keyword
- add_campaign_negative_keyword
- add_ad_group_negative_keyword
- list_policy_findings
- run_gaql_query
- get_change_history

## Expected Outputs
- Stabilization dashboard with daily KPI deltas
- Applied optimization log with reason codes
- Week-by-week decision summary and next actions

## Guardrails
- Avoid major structural rebuilds before enough learning data accumulates.
- Apply one major variable change per cycle when possible.
- Keep negative additions auditable with exact match preference for first pass.
