# Free-Tier and Security Strategy

## Will the free limits run out?

Not if the first public version is static-artifact first.

Use Cloudflare Pages for public traffic. Static asset requests are free and unlimited, so the dashboard should read prebuilt files like:

- `data/bootstrap.json`
- `data/states/NV/summary.json`
- `data/counties/32003/top-review-records.json`
- `data/downloads/*.parquet`

Avoid invoking Workers for normal page loads. Worker and D1 limits only matter once live search/filter endpoints are added.

## Free-tier risk model

Safe:

- Static Pages dashboard.
- One generated bootstrap JSON under a few MB.
- Top 50-500 red flags per jurisdiction layer as sharded JSON.
- Manual or scheduled deploy after local data build.
- Raw snapshots kept private in R2/B2.

Risky:

- Every page load calls a Worker.
- Search scans D1 tables without indexes.
- Full dataset shipped as one giant JSON file.
- Nightly full rewrite of millions of rows into D1.
- Scraping through the public app at request time.

## Practical limits

Cloudflare Pages:

- Static asset requests are free/unlimited.
- Pages Functions count against Workers request quota, so avoid Functions for the first version.

Cloudflare Workers Free:

- 100,000 requests/day.
- 10 ms CPU/request.
- 5 cron triggers/account.

Cloudflare D1 Free:

- 5 million rows read/day.
- 100,000 rows written/day.
- 5 GB total storage.

Cloudflare R2 Free:

- 10 GB-month storage.
- 1 million Class A operations/month.
- 10 million Class B operations/month.
- Egress is free.

Implication: public reads should be static; D1 should be reserved for small indexed searches or curated tables.

## Recommended launch shape

Phase 0:

- Nevada official-source demo dashboard.
- No Worker.
- No D1.
- Static `frontend/data/bootstrap.json`.
- Cloudflare Pages headers and noindex robots defaults.
- Optional WAF Managed Challenge before `/` and `/data/*`.

Phase 1:

- One state + a few counties/cities/district layers.
- Local SQLite/DuckDB ingest.
- Generated static JSON shards.
- Top red flags only in UI.
- Full source exports private in R2/B2.

Phase 2:

- Add D1 for indexed record lookup only.
- Keep summary/KPI/map static.
- D1 tables must have indexes for state, county, fiscal year, owner, vendor, severity.

Phase 3:

- If D1/Worker limits hurt, move backend to Postgres on a VPS or managed server. Do not start there.

## Anti-harassment and legal safety

Publish source-faithful facts, not accusations.

- Use "flag", "risk", "needs review", and "source discrepancy".
- Avoid "fraud", "corruption", or "crime" unless quoting an official enforcement source.
- Link every displayed claim to official raw source evidence.
- Keep a correction/removal contact path.
- Keep immutable snapshots so corrections can be audited.
- Do not publish private personal info.

## Privacy and anonymity

Cloudflare Pages hides any origin server because there is no origin server. That is better than hosting from a MacBook.

Use:

- GitHub org or separate account for the project.
- Domain privacy or an org/LLC/nonprofit registration.
- Cloudflare account with MFA and hardware key if available.
- Separate email, password manager, MFA, and recovery codes.
- No personal home IP in DNS.
- No public database admin tools.
- WAF/Turnstile challenge at Cloudflare edge, not fake JavaScript CAPTCHA in the app.

VPN:

- Good for personal browsing and admin work on public Wi-Fi.
- Not a guarantee of anonymity.
- Do not use VPNs, rotating proxies, or residential proxies to bypass official API limits, blocks, or terms.

If real personal risk is high, partner with a journalist, civic org, or lawyer before publishing names, allegations, or sensitive narratives.
