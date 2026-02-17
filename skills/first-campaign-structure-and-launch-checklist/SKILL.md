---
name: first-campaign-structure-and-launch-checklist
description: Pre-launch QA checklist for the first Google Ads campaign set. Use after build and before enabling campaigns to catch structural, policy, and tracking defects.
---

# first-campaign-structure-and-launch-checklist

## Cadence
Immediately before first launch.

## Objective
Prevent avoidable launch defects and ensure campaigns can learn efficiently from day one.

## Workflow
- Verify campaign, ad-group, and keyword naming consistency and intent separation.
- Confirm budget allocation, bid strategy alignment, and status states.
- Validate ad coverage, asset completeness, and final URL correctness.
- Check policy findings and resolve blockers before enablement.
- Confirm conversion actions, account selection, and post-launch monitoring plan.

## Core MCP Tools
- list_campaigns
- list_ad_groups
- list_keywords
- list_ads
- list_assets
- list_policy_findings
- list_conversion_actions
- run_gaql_query
- pause_campaign
- enable_campaign

## Expected Outputs
- Launch QA checklist with pass or fail for each control
- Blocking issues list and fix ownership
- Signed launch decision note

## Guardrails
- Do not enable campaigns with unresolved policy blockers.
- Do not launch with empty ad groups or missing conversion mapping.
- Keep a rollback plan before first enablement.
