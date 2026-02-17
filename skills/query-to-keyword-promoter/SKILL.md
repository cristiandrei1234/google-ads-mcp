---
name: query-to-keyword-promoter
description: Promote proven search terms into managed keywords and structure. Use when converting high-intent queries into exact/phrase coverage with tighter control.
---

# query-to-keyword-promoter

## Cadence
2-3 times per week

## Objective
Turn winning queries into managed assets and improve match efficiency.

## Workflow
- Identify search terms with repeated conversions or strong conversion rate.
- Map each term to destination ad group or create a new dedicated group if needed.
- Add exact and phrase variants, apply bid seed, and avoid duplicate keyword collisions.
- Add protective negatives in broader groups if cannibalization risk exists.

## Core MCP Tools
- get_search_terms
- list_keywords
- bulk_add_keywords
- create_ad_group
- add_ad_group_negative_keyword
- add_campaign_negative_keyword

## Expected Outputs
- Promoted keyword list with target ad-group
- Conflict/cannibalization notes
- Applied changes with IDs

## Guardrails
- Do not promote low-volume one-off terms.
- Respect existing match-type strategy per campaign.
- Check duplicates before insertion.
