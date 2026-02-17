---
name: assets-and-pmax-linking-ops
description: Manage assets, asset groups, and cross-level asset links for search and Performance Max. Use when operating asset inventory and attachment state across customer, campaign, ad group, and asset group scopes.
---

# assets-and-pmax-linking-ops

## Cadence
Weekly for hygiene; as needed for launches and refreshes.

## Objective
Maintain complete and correctly linked creative assets across delivery scopes.

## Workflow
- Create and inspect asset inventory before linking changes.
- Create and maintain asset groups for Performance Max structures.
- Link or unlink assets at customer, ad group, campaign, and asset group levels.
- Audit listing group structures and asset link coverage.
- Remove deprecated asset groups after migration.

## Core MCP Tools
- create_image_asset
- get_asset
- create_asset_group
- list_asset_groups
- get_asset_group
- update_asset_group
- remove_asset_group
- list_asset_group_listing_groups
- link_customer_asset
- unlink_customer_asset
- link_ad_group_asset
- unlink_ad_group_asset
- unlink_campaign_asset
- link_asset_group_asset
- unlink_asset_group_asset
- list_asset_links

## Expected Outputs
- Asset inventory and link matrix
- Asset group lifecycle report
- Missing-link remediation list

## Guardrails
- Never unlink critical assets from all scopes in a single pass.
- Verify asset type compatibility before linking.
- Keep production-safe fallback assets active.