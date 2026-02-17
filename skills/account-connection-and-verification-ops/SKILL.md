---
name: account-connection-and-verification-ops
description: Manage user-account connection and identity verification operations for Google Ads MCP. Use when account links must be revoked or identity verification status must be initiated and tracked.
---

# account-connection-and-verification-ops

## Cadence
As needed during onboarding, offboarding, and compliance checks.

## Objective
Keep account connectivity and verification states healthy and auditable.

## Workflow
- Confirm the impacted user and customer scope before any account unlink.
- Disconnect obsolete or unauthorized linked accounts.
- Start identity verification when eligibility and compliance conditions require it.
- Log reason, actor, and timestamp for each connection-state change.

## Core MCP Tools
- disconnect_user_account
- start_identity_verification

## Expected Outputs
- Connection change log per user and customer ID
- Verification initiation status
- Follow-up checklist for unresolved verification items

## Guardrails
- Never disconnect the active production account without explicit approval.
- Validate user and customer IDs before mutating access state.
- Keep an audit trail for all identity-related actions.