---
name: client-intake-and-goal-mapper
description: Structured Google Ads client intake and KPI mapping for both existing and greenfield accounts. Use when onboarding a new client to define business goals, conversion priorities, constraints, and success thresholds before account work.
---

# client-intake-and-goal-mapper

## Cadence
Once per new client, then refresh quarterly.

## Objective
Translate business goals into executable Google Ads targets and operating constraints.

## Workflow
- Collect core business context: offers, locations, margins, average order value, sales cycle, seasonality, and operational constraints.
- Define primary and secondary conversion goals, including what counts as qualified lead vs low-quality lead.
- Set numeric targets: CPA or ROAS, monthly lead or revenue targets, and acceptable ramp-up period.
- Build three budget lanes (minimum, target, aggressive) with expected risk profile.
- Align governance: approval owner, response SLA, reporting cadence, and escalation path.

## Core MCP Tools
- get_user_status
- list_user_linked_accounts
- list_accessible_accounts
- list_conversion_actions
- run_gaql_query

## Expected Outputs
- One-page intake brief with business and tracking assumptions
- KPI tree (impressions -> clicks -> leads or sales -> CPA or ROAS)
- Initial 30-day action plan with owner and deadline

## Guardrails
- Do not accept launch timelines before conversion definitions are finalized.
- Flag missing business inputs instead of filling with guesses.
- Keep assumptions explicit and versioned.
