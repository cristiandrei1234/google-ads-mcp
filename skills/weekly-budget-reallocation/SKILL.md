---
name: weekly-budget-reallocation
description: Weekly budget reallocation across campaigns based on efficiency and constraints. Use when redistributing spend to maximize account outcomes.
---

# weekly-budget-reallocation

## Cadence
Weekly

## Objective
Shift budget from low-return campaigns to constrained high-return campaigns.

## Workflow
- Calculate marginal performance by campaign and budget constraint status.
- Create reallocation matrix from donor campaigns to receiver campaigns.
- Validate against client priorities and campaign lifecycle stage.
- Apply approved budget updates and log expected KPI lift.

## Core MCP Tools
- list_campaign_budgets
- list_campaigns
- run_gaql_query
- update_campaign_budget
- attach_campaign_budget

## Expected Outputs
- Reallocation matrix
- Applied budget changes
- Expected incremental impact

## Guardrails
- Do not starve brand/protection campaigns below minimums.
- Respect seasonality and ongoing experiments.
- Cap weekly reallocation volatility.
