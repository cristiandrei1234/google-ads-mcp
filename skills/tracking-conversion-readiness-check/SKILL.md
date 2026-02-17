---
name: tracking-conversion-readiness-check
description: Validate conversion tracking and attribution setup for Google Ads. Use before launch, migration, or optimization to ensure decisions are made on reliable conversion data.
---

# tracking-conversion-readiness-check

## Cadence
Before first launch, after major site changes, and monthly for QA.

## Objective
Guarantee that optimization and reporting rely on accurate conversion signals.

## Workflow
- Inventory all conversion actions and map each one to funnel stage and business value.
- Confirm primary vs secondary assignment and remove duplicate primary goals.
- Validate lookback windows, counting method, and inclusion in conversions.
- Run query checks for sudden conversion drops, spikes, or lag anomalies.
- Document offline conversion import dependencies when sales close outside site.

## Core MCP Tools
- list_conversion_actions
- create_conversion_action
- update_conversion_action
- remove_conversion_action
- upload_click_conversion
- upload_call_conversion
- upload_conversion_adjustment
- run_gaql_query

## Expected Outputs
- Conversion health checklist with pass or fail status
- Corrected conversion action map (primary, secondary, value logic)
- Risk list for attribution and data quality gaps

## Guardrails
- Do not optimize bids against unvalidated conversion actions.
- Keep at least one stable primary goal per campaign objective.
- Never delete conversion actions without confirming historical reporting impact.
