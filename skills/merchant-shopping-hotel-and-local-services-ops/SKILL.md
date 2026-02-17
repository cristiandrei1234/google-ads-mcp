---
name: merchant-shopping-hotel-and-local-services-ops
description: Operate Merchant Center links, product feeds, and retail or vertical performance reads for Shopping, Hotel, and Local Services contexts. Use for commerce feed control and vertical reporting workflows.
---

# merchant-shopping-hotel-and-local-services-ops

## Cadence
Weekly for feed hygiene; daily during feed incidents.

## Objective
Keep commerce data connectivity and vertical performance visibility reliable.

## Workflow
- Create, inspect, and remove product entries as feed maintenance requires.
- Link and unlink Merchant Center accounts with explicit account mapping.
- Review Shopping and listing-group performance for catalog optimization.
- Pull Hotel and Local Services performance snapshots where applicable.
- Check reach plannable product data to support media planning.

## Core MCP Tools
- list_products
- get_product
- insert_product
- delete_product
- link_merchant_center
- list_merchant_center_links
- unlink_merchant_center
- list_shopping_performance
- list_listing_groups
- list_hotel_performance
- list_local_services_leads
- list_reach_plannable_products

## Expected Outputs
- Feed operation changelog
- Merchant link state matrix
- Vertical performance snapshot

## Guardrails
- Validate product identifiers before destructive feed operations.
- Do not unlink Merchant Center without replacement plan.
- Keep vertical reports segmented by relevant account scope.