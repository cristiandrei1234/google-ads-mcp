---
name: weekly-audience-cleanup
description: Weekly audience and targeting cleanup workflow. Use when pruning weak audience signals and reinforcing profitable segments.
---

# weekly-audience-cleanup

## Cadence
Weekly

## Objective
Improve targeting efficiency by removing drag and doubling down on signal quality.

## Workflow
- Review audience targeting performance at campaign and ad-group levels.
- Identify segments with consistent underperformance and low strategic value.
- Propose removals, bid adjustments, and high-performing audience expansion.
- Apply approved audience targeting updates and track changes.

## Core MCP Tools
- list_campaign_audience_targeting
- list_ad_group_audience_targeting
- list_custom_audiences
- list_combined_audiences
- add_campaign_custom_audience_targeting
- remove_campaign_audience_targeting
- add_ad_group_custom_audience_targeting
- remove_ad_group_audience_targeting

## Expected Outputs
- Audience keep/remove list
- Applied targeting changes
- Expected efficiency gains

## Guardrails
- Do not remove foundational remarketing audiences without replacement.
- Avoid simultaneous broad targeting expansion and budget cuts.
- Keep one change batch per cycle for clean read.
