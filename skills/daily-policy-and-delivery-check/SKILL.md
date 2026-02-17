---
name: daily-policy-and-delivery-check
description: Daily policy and delivery operations check. Use when verifying disapprovals, limited ads, delivery blocks, and critical account issues.
---

# daily-policy-and-delivery-check

## Cadence
Daily

## Objective
Catch deliverability blockers quickly so campaigns keep serving.

## Workflow
- List policy findings and identify disapproved or limited assets/ads.
- Check campaign and ad-group statuses for paused/removed or accidental stops.
- Highlight assets/ads that need replacement and provide exact impacted entities.
- Return remediation queue with priority based on spend/volume affected.

## Core MCP Tools
- list_policy_findings
- list_campaigns
- list_ad_groups
- list_ads
- get_change_history

## Expected Outputs
- Delivery blocker queue
- Policy issue summary by severity
- Recommended fixes and owner

## Guardrails
- Do not auto-remove ads without explicit approval.
- Separate policy issues from editorial/serving delays.
- Preserve historical IDs in the report.
