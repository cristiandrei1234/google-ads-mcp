---
name: recommendations-and-batch-jobs-ops
description: Operate recommendation actions and bulk execution via batch jobs. Use when changes need controlled recommendation handling or queued bulk mutations.
---

# recommendations-and-batch-jobs-ops

## Cadence
Weekly for recommendation triage; as needed for bulk operations.

## Objective
Apply or dismiss recommendations intentionally and execute large mutation sets safely.

## Workflow
- Pull recommendation candidates and classify by expected impact and risk.
- Apply only high-confidence recommendations with measurable rationale.
- Dismiss irrelevant recommendations to reduce noise.
- Create batch jobs for large updates, add operations, and run execution.
- Review batch status and capture outcomes for rollback planning.

## Core MCP Tools
- apply_recommendation
- dismiss_recommendation
- create_batch_job
- list_batch_jobs
- add_batch_job_operations
- run_batch_job

## Expected Outputs
- Recommendation action log with reasons
- Batch job execution summary and statuses
- Failed-operation list for remediation

## Guardrails
- Do not apply recommendations blindly.
- Use batch jobs for high-volume mutations, not single tactical edits.
- Keep mutation payloads traceable to a change request.