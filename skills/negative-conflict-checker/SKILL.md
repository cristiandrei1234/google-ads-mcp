---
name: negative-conflict-checker
description: Negative conflict checker between keywords and negatives. Use when diagnosing blocked traffic caused by overlapping negatives.
---

# negative-conflict-checker

## Cadence
2-3 times per week

## Objective
Prevent self-blocking and recover valid demand safely.

## Workflow
- Collect active positives and negatives across campaign/ad-group/shared-list scopes.
- Detect direct and thematic conflicts by match type behavior.
- Prioritize conflicts by lost volume/value potential.
- Propose safe removals or scope changes for negatives.

## Core MCP Tools
- list_keywords
- list_campaign_negative_keywords
- list_ad_group_negative_keywords
- list_shared_negative_keyword_lists
- run_gaql_query

## Expected Outputs
- Conflict matrix positive vs negative
- Risk-ranked unblock actions
- Safe rollback plan

## Guardrails
- Do not remove brand safety negatives automatically.
- Require confirmation for broad-scope negative removals.
- Keep before/after diff for audit.
