---
name: campaign-drafts-and-experiments-ops
description: Manage campaign draft lifecycle and experiment cleanup operations. Use when preparing staged campaign changes before promotion or resolving draft and experiment async issues.
---

# campaign-drafts-and-experiments-ops

## Cadence
When planning structural changes or controlled release waves.

## Objective
Ship major campaign changes through draft lifecycle with rollback visibility.

## Workflow
- Create campaign drafts for structural or high-impact settings changes.
- List and inspect drafts, then update metadata and contents as needed.
- Promote validated drafts into live configuration.
- Remove obsolete drafts and inspect async errors after operations.
- Remove stale or invalid experiments during cleanup cycles.

## Core MCP Tools
- create_campaign_draft
- list_campaign_drafts
- get_campaign_draft
- update_campaign_draft
- promote_campaign_draft
- remove_campaign_draft
- list_campaign_draft_async_errors
- remove_experiment
- list_experiment_async_errors

## Expected Outputs
- Draft lifecycle report (created, promoted, removed)
- Async error report with actionable fixes
- Change trace from draft to production

## Guardrails
- Do not promote drafts without QA evidence.
- Keep one source of truth for approved draft scope.
- Resolve async errors before scheduling related mutations.