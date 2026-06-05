# GAQL — Google Ads Query Language (quick guide for the demo)

## What it is
**GAQL = Google Ads Query Language.** It's the language you use to *read* data out of
Google Ads — campaigns, metrics, keywords, search terms, and so on. It looks strikingly
like SQL, but it queries the **Google Ads API**, not a classic database.

In this project, when you say in English *"show me the campaigns for the last 90 days"*,
Claude translates that into a GAQL statement and sends it through the **`run_gaql_query`**
tool → the Google Ads client executes the query → you get the rows back.

> One line for the camera:
> *"GAQL is Google's SQL-like query language for reading anything out of an Ads account.
> The agent writes the GAQL for me from plain English."*

---

## Anatomy of a query

```
SELECT   campaign.name, metrics.clicks, metrics.conversions   ← WHICH fields I want
FROM     campaign                                             ← FROM which resource
WHERE    segments.date BETWEEN '2026-03-07' AND '2026-06-05'  ← FILTER (e.g. date range)
ORDER BY metrics.clicks DESC                                  ← SORT
LIMIT    10                                                   ← how many rows
```

Four kinds of fields you combine:

| Prefix | What it is | Examples |
|---|---|---|
| **resource** | the entity | `campaign.name`, `ad_group.id`, `keyword.text` |
| **metrics** | performance numbers | `metrics.clicks`, `metrics.impressions`, `metrics.conversions`, `metrics.cost_micros` |
| **segments** | slices / dimensions | `segments.date`, `segments.device` |
| **attributes** | properties | `campaign.status`, `campaign.advertising_channel_type` |

---

## Example — campaign performance over 90 days

```sql
SELECT
  campaign.name,
  campaign.status,
  metrics.impressions,
  metrics.clicks,
  metrics.ctr,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE segments.date BETWEEN '2026-03-07' AND '2026-06-05'
  AND campaign.status = 'ENABLED'
ORDER BY metrics.clicks DESC
```

This returns exactly the table you show on screen: the Mobile vs Desktop campaigns with
impressions, clicks, CTR and conversions over the 90-day window.

---

## GAQL vs SQL — the differences that matter

| Classic SQL | GAQL |
|---|---|
| `JOIN` across tables | **No JOINs.** Each query has a single `FROM`; relationships come implicitly through fields (e.g. from `FROM campaign` you can still select `customer.id`). |
| `GROUP BY` | **Doesn't exist.** Aggregation happens automatically over the *non-metric* fields you select (resources + segments). |
| Cost as a normal number | Cost comes in **micros**: `metrics.cost_micros`. Divide by **1,000,000** for the real currency value (e.g. `5,230,000` micros = `5.23 RON`). |
| Free-form `WHERE date > '...'` | Dates: either an explicit range `segments.date BETWEEN '...' AND '...'`, or predefined constants. |

### Watch out for the 90-day window
Google ships ready-made date constants — `LAST_7_DAYS`, `LAST_14_DAYS`, `LAST_30_DAYS`,
`THIS_MONTH`, `LAST_MONTH` — **but there is NO `LAST_90_DAYS`.**
For 90 days you use an explicit range:

```sql
WHERE segments.date BETWEEN '2026-03-07' AND '2026-06-05'
```

(That's why, when you ask for "the last 90 days", the agent computes the dates and emits a `BETWEEN`.)

---

## A few useful gotchas
- **Statuses are enums**: in raw data they sometimes appear as numbers — `2 = ENABLED`,
  `3 = PAUSED`, `4 = REMOVED`. In GAQL you filter them by name: `campaign.status = 'ENABLED'`.
- **One row = one combination of segments.** If you add `segments.device`, the same campaign
  shows up on multiple rows (mobile / desktop / tablet).
- **Reporting resources** have a `_view` suffix: e.g. `search_term_view`, `keyword_view`,
  `geographic_view` — purpose-built for reports.
- **LIMIT** is your friend in a demo: it keeps the response short and readable on screen.

---

## How it ties into the project
- The MCP tool: **`run_gaql_query`** (in code: `src/tools/runQuery.ts` → `customer.query(gaql)`).
- It's a **read-only** tool — it only reads, never mutates — so it's perfectly safe to show live.
- Anything you see as a report in the Google Ads UI, you can pull with a GAQL through this tool.
