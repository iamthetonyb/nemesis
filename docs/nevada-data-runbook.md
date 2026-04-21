# Nevada Data Runbook

Current public demo is Nevada-first and static.

## What ships now

- Normal map basemap: OpenStreetMap raster tiles through MapLibre.
- Boundaries: U.S. Census TIGERweb Current MapServer.
- Nevada counties: TIGERweb Counties layer.
- Nevada congressional districts: TIGERweb 119th Congressional Districts layer.
- Federal spending map amounts: USAspending FY2026 `spending_by_category/county` and `spending_by_category/district`.
- Federal award examples: USAspending FY2026 `spending_by_award` for top Nevada contracts and assistance awards.
- Feedback: GitHub Issues prefilled by the static frontend, no database or server needed.

Rebuild:

```bash
node tools/generate-nevada-demo.mjs > frontend/data/bootstrap.json
```

Validate:

```bash
node --check frontend/assets/js/app.js
node --check frontend/assets/js/map.js
node --check tools/generate-nevada-demo.mjs
node -e "JSON.parse(require('fs').readFileSync('frontend/data/bootstrap.json','utf8'))"
```

## Accuracy rules

- Review amount means official source amount selected for review.
- Review tier is amount-volume only.
- Do not call a row waste, fraud, corruption, or abuse unless an official enforcement or audit source says that.
- County and district aggregates can overlap with award examples. Do not add them together.
- Keep raw source snapshots private; publish generated source-linked artifacts.

## Next Nevada connectors

1. State: Nevada Open Finance Portal / Checkbook for budget, checkbook, payroll, and pension disbursements.
2. Exclusions: Nevada OpenBudget exclusion page must be represented in the UI before claiming full state spend coverage.
3. City: Las Vegas Open Checkbook and Open Budget portal.
4. School: Clark County School District Open Book.
5. County: Clark County, Washoe County, Carson City, and county budget/ACFR PDFs where no API exists.
6. Districts: official wards/council districts, school districts, utility/water/transit authorities, judicial districts, legislative districts.

## Public hosting

Use Cloudflare Pages for the demo. Keep it static until search requires an indexed API.

For public testing:

- Leave `robots.txt` and `X-Robots-Tag` noindex during early feedback.
- Add Cloudflare WAF Managed Challenge to `/` and `/data/*` if bot traffic starts.
- Upgrade map tiles before heavy traffic; `tile.openstreetmap.org` is acceptable for low-volume testing but has no SLA and is not for heavy production.
