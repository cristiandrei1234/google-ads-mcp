---
name: monthly-structure-review
description: Monthly account structure review for Google Ads. Use when deciding restructures by campaign type, match type, device, geo, and budget architecture.
---

# monthly-structure-review

## Cadence
Monthly

## Objective
Keep account architecture aligned with scale, control, and reporting needs.

## Workflow
- Audit current structure quality: campaign purpose clarity, ad-group tightness, keyword hygiene, naming conventions.
- Evaluate segmentation opportunities by device, geography, intent, and product/service lines.
- Propose structural changes with migration plan and rollback strategy.
- Define staged rollout and monitoring checkpoints.

## Core MCP Tools
- list_campaigns
- list_ad_groups
- list_keywords
- run_gaql_query
- duplicate_campaign
- duplicate_campaign_by_device
- create_campaign
- create_ad_group

## Expected Outputs
- Structure health assessment
- Restructure proposal with phases
- Migration and rollback checklist

## Guardrails
- Do not execute large restructures in one batch.
- Maintain tracking continuity during migration.
- Preserve historical comparability in reporting.
