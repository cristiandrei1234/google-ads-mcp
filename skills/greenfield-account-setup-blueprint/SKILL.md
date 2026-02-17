---
name: greenfield-account-setup-blueprint
description: End-to-end setup blueprint for clients without an existing Google Ads account. Use to create a clean account foundation, campaign structure, and policy-safe launch baseline.
---

# greenfield-account-setup-blueprint

## Cadence
One-time initial setup, then reused for expansion waves.

## Objective
Create a launch-ready account with clean structure, controls, and measurement.

## Workflow
- Validate account access, billing state, and conversion readiness before build.
- Create campaign budgets, campaigns, and campaign settings with paused launch state.
- Configure targeting guardrails: geo, language, network, schedule, and device modifiers.
- Build ad groups, add core keywords, and apply initial negatives.
- Create ads and assets, then attach required asset links and labels.

## Core MCP Tools
- list_accessible_accounts
- list_billing_setups
- create_campaign_budget
- create_campaign
- update_campaign_settings
- set_campaign_network_settings
- set_campaign_geo_targeting
- set_campaign_language_targeting
- set_campaign_ad_schedule
- set_campaign_device_modifiers
- create_ad_group
- bulk_add_keywords
- add_campaign_negative_keyword
- add_ad_group_negative_keyword
- create_responsive_search_ad
- create_text_asset
- link_campaign_asset

## Expected Outputs
- Initial account architecture map
- Paused launch package ready for review
- Build log with created resources and IDs

## Guardrails
- Keep all net-new campaigns paused until QA is complete.
- Do not skip negative keyword baseline creation.
- Use deterministic naming conventions for every entity.
