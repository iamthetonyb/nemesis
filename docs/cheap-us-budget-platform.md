# Cheap US Budget Platform Plan

Goal: adapt Nemesis into a US public-budget/procurement dashboard with near-zero hosting cost, source-faithful data, and no always-on VPS.

Scope includes every official government layer that can be sourced: federal, state, county, city/town/township, ward/council district, school district, special district, transit/water/utility authority, legislative district, judicial district, and grant/pass-through entities. Each layer must carry its own source and boundary confidence instead of being forced into county or ward buckets.

## Hosting Decision

Use Cloudflare first:

- Cloudflare Pages for the static frontend.
- Cloudflare Workers only for small API/search endpoints.
- Cloudflare D1 only for small public query tables.
- Cloudflare R2 for immutable raw snapshots, generated exports, and backups.
- Local MacBook for heavy ingestion, linting, dedupe, joins, and model-assisted review.
- Rust CLIs for correctness-sensitive ingestion, hashing, reconciliation, and artifact validation.

Avoid an always-on VPS until traffic or query size forces it. A VPS is simpler for Postgres, but it creates a monthly bill, patching burden, exposed SSH, and uptime responsibility.

## Runtime Decision

Use a static Cloudflare frontend plus a Rust data plane. Keep Node as optional local tooling while Rust validators and ingestion CLIs mature. Do not add Deno Deploy or a second edge platform unless a one-page architecture decision proves it is cheaper or simpler than Cloudflare Workers/Rust.

See `docs/architecture-runtime-decision.md`.

## Data Shape

Keep raw truth separate from dashboard output:

- `raw_sources`: source URL, retrieved_at, hash, license, jurisdiction, file path.
- `jurisdictions`: country, state, county, city, ward, district, FIPS/GEOID when available.
- `procurements`: source_id, title, agency, vendor, amount, dates, category, location ids.
- `budgets`: fiscal_year, fund, department, account, adopted, revised, actual.
- `audit_flags`: deterministic rule id, score, explanation, evidence fields.

Do not let AI write factual columns. AI can draft review notes against raw records, but every public field should be traceable to an official source row.

## Pipeline

Local cron or GitHub Actions:

1. Download official data.
2. Store original file in `data/raw/`.
3. Hash file and write manifest.
4. Normalize into DuckDB or SQLite.
5. Validate totals against official published totals with Rust gates.
6. Export compressed public artifacts:
   - static JSON for maps and KPI cards
   - SQLite/D1 tables for search/detail pages
   - Parquet for future analytics
7. Upload raw snapshots and exported artifacts to R2 or B2.
8. Deploy frontend to Cloudflare Pages.

## Source Priority

Federal:

- USAspending bulk/API for awards.
- SAM.gov API for opportunities.
- Census/TIGER for county and district geography.

Local:

- Official Socrata, CKAN, ArcGIS REST, OpenGov export, or city/county CSV first.
- PDF scraping last, with human review.
- Wards must come from official local GIS boundaries.

## Cheap Storage

Recommended:

- Cloudflare R2 for app artifacts and public-ish generated files.
- Backblaze B2 for personal/offsite backup if already paying for it.
- Keep one local encrypted backup on external disk.

Rules:

- Raw snapshots are append-only.
- Bucket is private by default.
- Public dashboard reads only sanitized generated artifacts.
- Rotate API keys quarterly.
- Use least-privilege tokens: upload-only for cron, read-only for dashboard if needed.

## Security Baseline

- No database admin UI on the public internet.
- No secrets in repo.
- `.env` stays local; Cloudflare secrets go through Wrangler/dashboard.
- R2/B2 buckets private unless a specific object path must be public.
- Enable MFA on GitHub, Cloudflare, Backblaze.
- Pin dependencies and run `pnpm audit` plus lint checks in CI.
- Nightly backup restore test locally.

## First Code Changes

1. Rename dashboard labels from Indonesia/LKPP to generic US budget/procurement.
2. Add source registry config.
3. Add local `scripts/ingest-us-*` pipeline.
4. Replace Indonesia geo seed with downloaded Census/local GeoJSON.
5. Add generated fixture data across county, city/ward, and district layers so frontend works before full ingest.
6. Add Cloudflare Pages/Workers config after API shape is stable.
