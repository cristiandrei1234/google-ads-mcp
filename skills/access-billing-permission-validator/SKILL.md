---
name: access-billing-permission-validator
description: Validate Google Ads access, account linking, and billing readiness before audit or launch. Use when a client is newly onboarded or when authentication and permissions are unstable.
---

# access-billing-permission-validator

## Cadence
At onboarding and whenever access errors appear.

## Objective
Ensure the team can safely operate the right accounts with valid permissions and active billing.

## Workflow
- Confirm linked user accounts and selected default account for MCP execution.
- Verify the correct manager and sub-account scope is selected.
- Check billing setup state, account budgets, and invoice visibility.
- Validate identity verification status when applicable.
- Produce a remediation list for missing permissions, suspended billing, or account mismatch.

## Core MCP Tools
- get_user_status
- list_user_linked_accounts
- select_user_accounts
- set_default_user_account
- list_accessible_accounts
- list_billing_setups
- list_account_budgets
- list_invoices
- get_identity_verification

## Expected Outputs
- Access matrix (who can do what)
- Billing readiness status per account
- Blockers list with exact action owner

## Guardrails
- Never run mutable operations before access and billing pass checks.
- Do not infer permissions from UI claims; verify with tool responses.
- Keep account IDs explicit in every step.
