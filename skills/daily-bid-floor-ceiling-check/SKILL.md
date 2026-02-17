---
name: daily-bid-floor-ceiling-check
description: Daily bid floor/ceiling check at keyword level. Use when adjusting bids for efficiency while protecting traffic volume.
---

# daily-bid-floor-ceiling-check

## Cadence
Daily

## Objective
Correct bid outliers that are too expensive or too conservative.

## Workflow
- Pull keyword-level spend, clicks, conversions, CPA, impression share proxies.
- Flag high-bid losers and low-bid winners based on target CPA/ROAS rules.
- Generate bounded bid adjustments with per-keyword rationale.
- Apply changes in bulk only after rule validation and optional approval.

## Core MCP Tools
- list_keywords
- run_gaql_query
- bulk_update_keywords
- update_keyword

## Expected Outputs
- Bid outlier table with reason codes
- Proposed and applied bid changes
- Expected impact summary

## Guardrails
- Never change bids for keywords with insufficient data.
- Respect min/max bid caps defined by user.
- Exclude experiment cohorts unless requested.
