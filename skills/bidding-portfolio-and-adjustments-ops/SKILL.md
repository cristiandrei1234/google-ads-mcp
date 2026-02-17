---
name: bidding-portfolio-and-adjustments-ops
description: Manage portfolio bidding strategies plus seasonality adjustments and data exclusions. Use when advanced bidding governance is required across campaign and portfolio scopes.
---

# bidding-portfolio-and-adjustments-ops

## Cadence
Weekly for governance; pre-event for planned traffic shifts.

## Objective
Control advanced bidding primitives safely and transparently.

## Workflow
- Create and maintain portfolio bidding strategies per objective cluster.
- Attach or clear portfolio strategy links at campaign level.
- Update strategy parameters based on measured outcomes.
- Create seasonality adjustments for short planned conversion-rate shifts.
- Create and maintain data exclusions for invalid signal windows.

## Core MCP Tools
- create_portfolio_bidding_strategy
- list_bidding_strategies
- get_bidding_strategy
- update_portfolio_bidding_strategy
- remove_portfolio_bidding_strategy
- set_campaign_portfolio_bidding_strategy
- clear_campaign_portfolio_bidding_strategy
- create_bidding_seasonality_adjustment
- list_bidding_seasonality_adjustments
- get_bidding_seasonality_adjustment
- update_bidding_seasonality_adjustment
- remove_bidding_seasonality_adjustment
- create_bidding_data_exclusion
- list_bidding_data_exclusions
- get_bidding_data_exclusion
- update_bidding_data_exclusion
- remove_bidding_data_exclusion

## Expected Outputs
- Bidding strategy inventory and campaign mapping
- Adjustment and exclusion timeline
- Change-impact report on efficiency KPIs

## Guardrails
- Use seasonality adjustments only for clearly bounded events.
- Timebox data exclusions and document rationale.
- Avoid overlapping strategy changes in the same decision window.