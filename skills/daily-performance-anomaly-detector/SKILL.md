---
name: daily-performance-anomaly-detector
description: Daily anomaly detection for campaign performance. Use when checking sudden shifts in CPC, CTR, CPA, CVR, spend, impressions, or conversions.
---

# daily-performance-anomaly-detector

## Cadence
Daily

## Objective
Detect regressions early and surface root-cause candidates before spend is wasted.

## Workflow
- Compare TODAY and yesterday against rolling 7-day and 30-day baselines.
- Detect anomalies on spend, clicks, impressions, CTR, CPC, conversions, CVR, CPA.
- Break anomalies by campaign, ad group, keyword, device where available.
- Produce ranked incident list with likely causes and next actions.

## Core MCP Tools
- run_gaql_query
- list_campaigns
- list_ad_groups
- list_keywords
- get_change_history

## Expected Outputs
- Anomaly incident list sorted by financial impact
- Diagnostic cuts by device/query/ad-group
- Immediate actions to test

## Guardrails
- Ignore low-volume noise by minimum data thresholds.
- Do not auto-apply bid or budget changes from anomaly signal alone.
- Always include confidence level.
