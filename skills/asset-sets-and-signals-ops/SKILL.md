---
name: asset-sets-and-signals-ops
description: Operate asset sets, campaign asset set links, asset set assets, and Performance Max asset group signals. Use for advanced PMax configuration and signal governance workflows.
---

# asset-sets-and-signals-ops

## Cadence
At launch and major PMax optimization cycles.

## Objective
Control reusable asset-set architecture and audience-signal quality.

## Workflow
- Create and maintain reusable asset sets by business objective.
- Link asset sets to campaigns and manage per-campaign associations.
- Manage assets inside asset sets with explicit add or remove lifecycle.
- Create and tune asset group signals to guide PMax exploration.
- Audit current signal and linkage state before removals.

## Core MCP Tools
- create_asset_set
- list_asset_sets
- get_asset_set
- update_asset_set
- remove_asset_set
- link_asset_set_asset
- unlink_asset_set_asset
- get_asset_set_asset
- list_asset_set_assets
- link_campaign_asset_set
- unlink_campaign_asset_set
- get_campaign_asset_set
- list_campaign_asset_sets
- create_asset_group_signal
- list_asset_group_signals
- get_asset_group_signal
- update_asset_group_signal
- remove_asset_group_signal

## Expected Outputs
- Asset-set topology map
- Campaign-to-asset-set link report
- Signal update log with rationale

## Guardrails
- Do not remove shared asset sets before dependency checks.
- Keep signal edits incremental to preserve learnings.
- Record linkage changes with campaign and asset-set IDs.