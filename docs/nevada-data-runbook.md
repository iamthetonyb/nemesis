# Nevada Data Runbook

Quick reference for working with Nevada dashboard data. See `docs/data-sources/` for per-source details and `docs/ingestion-pipeline.md` for automation.

## Current Data (FY 2026 Demo)

| Layer | Source | Status |
|-------|--------|--------|
| Federal awards by county | USAspending.gov API | ✅ Live |
| Federal awards by congressional district | USAspending.gov API | ✅ Live |
| County/district boundaries | Census TIGERweb | ✅ Live |
| State checkbook | Nevada Open Books (checkbook.nv.gov Socrata) | ✅ Live — $30.96B, 108 agencies |
| State budget (w/ exclusions) | Nevada OpenBudget | 🔴 Pending |
| Las Vegas city checkbook | Las Vegas OpenGov | 🔴 Pending — configure report ID |
| CCSD school budget | CCSD Open Book (OpenGov) | 🔴 Pending |
| Clark County | Socrata (data.clarkcountynv.gov) | 🔴 Pending — confirm dataset ID |
| Washoe County | PDF ACFR | 🔴 Pending |
| Carson City | PDF ACFR | 🔴 Pending |
| RTC Southern Nevada | Socrata (data.rtcsnv.com) | 🟡 Verify portal |
| WCSD school budget | OpenGov or PDF | 🟡 Verify source |
| Water/utility districts | PDF ACFRs | 🔴 Pending |

## Rebuild Demo Data

```bash
pnpm generate:nevada       # regenerates frontend/data/bootstrap.json from APIs
pnpm validate:data         # Rust validator — hard gate before any commit
pnpm check                 # full gate (JS + Rust + validate + backend audit)
pnpm context:compile       # refresh docs/PROJECT_CONTEXT.md (AI-loadable state snapshot)
```

In any Claude Code session, type `/audit` to run the full gate interactively, or `/add-source` to scaffold a new connector.

## Accuracy Rules

- "Review amount" = official source amount selected for priority review, not an allegation
- "Review tier" = amount-volume signal (Low / Medium / High / Extreme)
- Do not call a row waste, fraud, corruption, or abuse unless an official enforcement or audit source confirms it
- County and district totals can overlap with award samples — do not add them together
- OpenBudget exclusions must be displayed in UI before claiming full state spend coverage
- Label Transparent Nevada (transparentnevada.com) as "independent source" — it is not an official state portal

## Source Priority for Next Connectors

1. Nevada state checkbook (openbooks.nv.gov) — configure OpenGov report ID
2. Las Vegas city checkbook (lasvegasnevada.opengov.com) — configure OpenGov report ID
3. Clark County Socrata — verify dataset ID at data.clarkcountynv.gov
4. CCSD Open Book — confirm OpenGov subdomain
5. RTC Southern Nevada — verify Socrata at data.rtcsnv.com
6. Washoe County + WCSD — parallel work with Reno/northern Nevada expansion

See `docs/data-sources/` for detailed per-source runbooks.
See `docs/ingestion-pipeline.md` for automation and GitHub Actions setup.
