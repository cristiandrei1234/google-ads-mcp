---
name: daily-budget-pacing-guard
description: Daily budget pacing guardrail for Google Ads accounts. Use when comparing month-to-date spend vs plan and deciding budget increases, decreases, or reallocations.
---

# daily-budget-pacing-guard

## Cadence
Daily

## Objective
Keep monthly spend on target while protecting CPA/ROAS constraints.

## Workflow
- Compute month-to-date pacing by campaign and compare with ideal linear spend curve.
- Flag overspending campaigns with weak efficiency and underspending campaigns with strong efficiency.
- Propose budget moves: reduce waste first, then increase budgets on constrained profitable campaigns.
- Apply approved changes with budget update tools and keep an audit trail.

## Core MCP Tools
- run_gaql_query
- list_campaigns
- list_campaign_budgets
- update_campaign_budget
- attach_campaign_budget

## Expected Outputs
- Pacing report with over/under status
- Proposed budget deltas per campaign
- Applied budget changes

## Guardrails
- Never increase budget on campaigns above target CPA without approval.
- Cap daily budget change magnitude unless user asks otherwise.
- Preserve shared budget intent when present.
