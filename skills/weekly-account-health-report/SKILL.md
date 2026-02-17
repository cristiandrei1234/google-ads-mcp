---
name: weekly-account-health-report
description: Weekly Google Ads account health report with priority actions. Use when preparing operator review with KPI trends and issue ranking.
---

# weekly-account-health-report

## Cadence
Weekly

## Objective
Provide one weekly operational dashboard that drives next-week actions.

## Workflow
- Aggregate KPI trends over 7/30-day windows by campaign and ad group.
- Summarize spend, conversions, CPA/ROAS, impression and click signals.
- Rank opportunities and risks by financial impact and confidence.
- Produce next-week action plan with owner and expected outcome.

## Core MCP Tools
- run_gaql_query
- list_campaigns
- list_ad_groups
- list_keywords
- get_change_history

## Expected Outputs
- Weekly executive table
- Top risks/opportunities
- Prioritized action plan

## Guardrails
- Keep methodology consistent week-over-week.
- Separate correlation from causation in commentary.
- Include unresolved blockers from prior week.
