---
name: audience-targeting-advanced-ops
description: Manage advanced audience resources and targeting attachments, including custom and combined audiences. Use when audience strategy requires creation, updates, and explicit targeting controls.
---

# audience-targeting-advanced-ops

## Cadence
Weekly optimization and pre-launch audience setup.

## Objective
Keep audience resources and targeting attachments aligned with intent strategy.

## Workflow
- Create and maintain custom audience resources for intent themes.
- Inspect combined audience resources before targeting updates.
- Add audience targeting at campaign and ad-group scope as designed.
- Remove stale audience resources when no longer needed.
- Pull audience insights to inform next targeting iteration.

## Core MCP Tools
- create_custom_audience
- list_custom_audiences
- get_custom_audience
- update_custom_audience
- remove_custom_audience
- get_combined_audience
- add_campaign_custom_audience_targeting
- add_ad_group_custom_audience_targeting
- add_campaign_combined_audience_targeting
- add_ad_group_combined_audience_targeting
- list_audience_insights

## Expected Outputs
- Audience resource inventory and status
- Targeting attachment changes by scope
- Audience insights summary and action plan

## Guardrails
- Validate targeting scope before attaching audiences.
- Avoid duplicate audience semantics across custom resources.
- Keep removal operations dependency-aware.