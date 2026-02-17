---
name: campaign-adgroup-ad-keyword-lifecycle-ops
description: Full lifecycle operations for campaigns, ad groups, ads, and keywords including detail reads and status mutation. Use for CRUD-style governance and cleanup tasks beyond routine optimization.
---

# campaign-adgroup-ad-keyword-lifecycle-ops

## Cadence
Daily for tactical controls; weekly for structure cleanup.

## Objective
Maintain precise control over core entities and prevent structural drift.

## Workflow
- Read entity details before mutation to verify current state.
- Apply status and removal actions at the smallest safe scope.
- Clone ad groups when split-testing structure changes.
- Remove obsolete keywords and negatives that no longer fit strategy.
- Validate campaign-level settings align with operating policy.

## Core MCP Tools
- get_campaign
- get_campaign_budget
- remove_campaign
- detach_campaign_budget
- set_campaign_bidding_strategy
- set_campaign_content_exclusions
- set_campaign_labels
- get_ad_group
- update_ad_group
- clone_ad_group
- pause_ad_group
- enable_ad_group
- remove_ad_group
- get_ad
- pause_ad
- enable_ad
- remove_ad
- add_keyword
- get_keyword
- remove_keyword
- bulk_remove_keywords
- get_ad_group_negative_keyword
- get_campaign_negative_keyword
- remove_ad_group_negative_keyword
- remove_campaign_negative_keyword

## Expected Outputs
- Entity mutation changelog with before and after state
- Cleanup report for removed or archived entities
- Settings compliance summary at campaign scope

## Guardrails
- Always fetch entity state before remove operations.
- Avoid simultaneous bulk removals across parent and child entities.
- Keep rollback notes for any structural mutations.