---
name: device-profit-split-planner
description: Device profitability split planner for Search campaigns. Use when desktop/mobile/tablet efficiency diverges and campaign splitting by device can unlock better control.
---

# device-profit-split-planner

## Cadence
2-3 times per week

## Objective
Create clean device-specific structures to maximize profit by channel-device fit.

## Workflow
- Measure performance by device and quantify CPA/ROAS gaps.
- Recommend split only when gap is material and stable over lookback window.
- Create paused clones per device strategy and apply device bid modifiers or structure rules.
- Return QA checklist before activation (tracking, budgets, overlap, negatives).

## Core MCP Tools
- run_gaql_query
- duplicate_campaign_by_device
- duplicate_campaign
- set_campaign_device_modifiers
- list_campaigns

## Expected Outputs
- Device split recommendation with thresholds
- Created paused campaigns for review
- Activation checklist

## Guardrails
- Do not activate new split campaigns automatically.
- Ensure naming convention and labels are consistent.
- Avoid double-serving overlap without exclusions plan.
