---
name: conversion-goals-offline-data-and-customer-match-ops
description: Operate conversion goals, user lists, offline user data jobs, and Customer Match pipelines. Use when measurement and audience activation require advanced conversion and upload workflows.
---

# conversion-goals-offline-data-and-customer-match-ops

## Cadence
Weekly for monitoring; as needed for import and goal changes.

## Objective
Ensure conversion governance and first-party audience activation are complete and reliable.

## Workflow
- Inspect conversion action and goal configuration at customer and campaign levels.
- Set customer and campaign conversion goals according to optimization policy.
- Create and manage user lists used for targeting and exclusions.
- Run offline user data job lifecycle from creation to operation upload and execution.
- Execute Customer Match member add or remove workflows and track job status.

## Core MCP Tools
- get_conversion_action
- get_customer_conversion_goal
- list_customer_conversion_goals
- set_customer_conversion_goal
- get_campaign_conversion_goal
- list_campaign_conversion_goals
- set_campaign_conversion_goal
- create_user_list
- get_user_list
- list_user_lists
- create_offline_user_data_job
- add_offline_user_data_job_operations
- run_offline_user_data_job
- create_customer_match_job_with_members
- add_customer_match_members
- remove_customer_match_members
- list_customer_match_jobs

## Expected Outputs
- Conversion goal state report by scope
- Offline upload execution log
- Customer Match job outcomes and pending actions

## Guardrails
- Do not change goals without confirming bidding dependency impact.
- Ensure upload payload normalization before execution.
- Keep customer data handling compliant and minimal.