---
name: negative-keyword-and-customer-negative-governance-ops
description: Govern shared negative keyword lists and customer-level negative criteria. Use when central exclusions, campaign attachments, and placement blocks require controlled lifecycle management.
---

# negative-keyword-and-customer-negative-governance-ops

## Cadence
Weekly hygiene; immediate action for waste spikes.

## Objective
Centralize exclusion logic and keep negative controls clean and reusable.

## Workflow
- Create and version shared negative keyword lists by theme.
- Attach and detach shared lists to campaigns based on current strategy.
- Add and remove list entries while preserving naming consistency.
- Audit customer-level negative criteria and placement blocks.
- Remove stale or conflicting customer-level negatives.

## Core MCP Tools
- create_shared_negative_keyword_list
- update_shared_negative_keyword_list
- remove_shared_negative_keyword_list
- get_shared_negative_keyword_list
- add_shared_negative_keyword
- remove_shared_negative_keyword
- attach_shared_negative_list_to_campaign
- detach_shared_negative_list_from_campaign
- list_customer_negative_criteria
- add_customer_negative_placement
- remove_customer_negative_criterion

## Expected Outputs
- Shared negative list inventory and attachment map
- Applied exclusions changelog
- Customer-level negative criteria cleanup report

## Guardrails
- Do not remove broad protection negatives without replacement.
- Keep list names deterministic and purpose-specific.
- Confirm campaign scope before attach or detach operations.