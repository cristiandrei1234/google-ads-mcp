---
name: keyword-planner-budget-forecaster
description: Keyword Planner based budget and traffic forecasting for new Google Ads accounts. Use when defining realistic spend scenarios and expected click or conversion ranges before launch.
---

# keyword-planner-budget-forecaster

## Cadence
Before launch and whenever budget planning is revised.

## Objective
Produce transparent budget scenarios tied to keyword demand and expected delivery.

## Workflow
- Build a keyword plan with campaign and ad-group structure aligned to intent clusters.
- Add candidate keywords and run forecast metrics for 30-day windows.
- Build low, base, and high budget scenarios using conservative and optimistic CPC assumptions.
- Translate forecasted clicks into conversion ranges using agreed CVR bands.
- Recommend launch budget and minimum viable budget to reach learning stability.

## Core MCP Tools
- create_keyword_plan
- update_keyword_plan
- remove_keyword_plan
- create_keyword_plan_campaign
- create_keyword_plan_ad_group
- add_keyword_plan_keywords
- generate_keyword_forecast_metrics
- generate_keyword_historical_metrics

## Expected Outputs
- Three budget scenarios with assumptions
- Estimated clicks, conversions, and CPA range per scenario
- Suggested launch budget with confidence notes

## Guardrails
- Never present a single-point forecast without scenario bands.
- Keep CPC and CVR assumptions explicit and client-approved.
- Re-run forecast after major location, language, or keyword scope changes.
