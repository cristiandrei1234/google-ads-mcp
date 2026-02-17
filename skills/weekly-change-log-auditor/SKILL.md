---
name: weekly-change-log-auditor
description: Weekly change log auditor for Google Ads operations. Use when reviewing what changed, why it changed, and what it impacted.
---

# weekly-change-log-auditor

## Cadence
Weekly

## Objective
Create accountability and traceability for account changes.

## Workflow
- Pull change history for last 7 days and categorize by entity and operator intent.
- Map major changes to KPI movements and identify risky edits.
- Surface accidental or unauthorized changes for rollback review.
- Publish concise audit summary with recommendations.

## Core MCP Tools
- get_change_history
- run_gaql_query
- list_campaigns
- list_ad_groups
- list_keywords

## Expected Outputs
- Weekly change audit log
- High-risk change alerts
- Rollback candidate list

## Guardrails
- Do not infer causality without timing and magnitude support.
- Preserve immutable copy of raw change events.
- Flag unknown origin changes explicitly.
