---
name: daily-search-terms-hygiene
description: Daily search term mining and hygiene for Search campaigns. Use when reviewing yesterday/today query traffic, deciding negatives, and promoting high-intent terms into exact/phrase keywords.
---

# daily-search-terms-hygiene

## Cadence
Daily

## Objective
Reduce wasted spend from irrelevant queries and harvest profitable terms every day.

## Workflow
- Pull search terms for TODAY and LAST_7_DAYS by campaign and ad group.
- Classify each term as KEEP, NEGATIVE, or PROMOTE based on intent and conversion signals.
- Apply negatives at ad-group or campaign level with correct match type (EXACT for precise blockers, PHRASE for theme blockers).
- Promote winning terms into keyword sets with exact and phrase variants in the correct ad group.
- Return a compact changelog with term, action, scope, and expected impact.

## Core MCP Tools
- get_search_terms
- run_gaql_query
- list_keywords
- bulk_add_keywords
- add_campaign_negative_keyword
- add_ad_group_negative_keyword
- list_campaign_negative_keywords
- list_ad_group_negative_keywords

## Expected Outputs
- Daily hygiene table: term -> action -> scope
- Applied changes with resource names
- Pending manual review items

## Guardrails
- Do not add broad negatives without explicit confirmation.
- Do not modify brand terms unless explicitly requested.
- Prefer validate-only dry run for first execution on new account.
