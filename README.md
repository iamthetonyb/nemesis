# USA Spending Watch

Independent public spending dashboard for federal, state, county, city, district, and authority layers. Current demo data is Nevada-first and powered by official USAspending and Census source slices; the shell is built to grow nationwide.

Live demo: [gov-budget.pages.dev](https://gov-budget.pages.dev) · Repo: [iamthetonyb/USAspend](https://github.com/iamthetonyb/USAspend) · Future domain: usaspending.us

---

## What It Does

- County-first map of FY 2026 spending by jurisdiction layer
- Priority records flagged by volume tier (Low / Medium / High / Extreme)
- Filter by funding source: Federal, State, Local / District, Others
- Search and sort across jurisdictions and federal agencies
- Drill into individual records with source links back to official data
- Optional sound/haptic feedback for key controls, generated in-browser with no audio files
- Compressed same-origin hero motion background with static poster fallback
- Lazy-loaded Turnstile feedback protection only when configured and opened

All displayed claims link to official source snapshots. Labels use "review", "priority", and "needs review" — not accusations of fraud or waste.

---

## Quick Start (Demo)

```bash
cd frontend
python3 -m http.server 8090
```

Open `http://127.0.0.1:8090`. No backend or install step needed — reads from `frontend/data/bootstrap.json`.

---

## Architecture

Static-first public app. Rust-first data validation and ingestion path. No frontend build step, no bundler, no always-on VPS.

```
frontend/
  index.html                  Dashboard shell
  assets/js/config.js         Runtime config (static data URL + Turnstile key)
  assets/js/app.js            Dashboard logic
  assets/js/map.js            MapLibre GL JS v5 wrapper
  assets/js/sensory.js        Optional Web Audio + Vibration API feedback
  assets/css/styles.css       All styles
  assets/css/fonts.css        Self-hosted font declarations
  assets/fonts/               Local WOFF2 fonts (no Google Fonts request)
  assets/media/               Hero video + poster assets
  assets/vendor/              Local vendor assets (MapLibre GL)
  data/bootstrap.json         Pre-generated jurisdiction + GeoJSON data
  data/manifest.json          SHA-256 public artifact manifest
  sitemap.xml                 Generated route sitemap
  .well-known/security.txt    Coordinated disclosure contact
  _headers                    Cloudflare Pages security headers (CSP, HSTS, etc.)

backend/                      Node.js + Express 5 + SQLite (optional, full dataset)
crates/spending-validate/     Rust validation gate for public JSON artifacts
tools/                        Data generation + setup scripts
docs/                         Architecture and security notes
```

Toolchain: `pnpm` for JS/deploy, `cargo` for Rust. The frontend requires nothing — any static file server works. See `docs/architecture-runtime-decision.md` for full reasoning.

---

## Optional Local Backend (Full Dataset)

Not needed for the demo. Unlocks live search and pagination across the full dataset.

**Prerequisites:** Node.js 22+, pnpm 10+

```bash
# Enable pnpm via Corepack (one-time)
corepack enable

# Install dependencies
cd backend
pnpm install

# Add dataset
# Download dashboard.sqlite and place at backend/data/dashboard.sqlite

# Configure
cp .env.example .env
# Edit .env: set CORS_ORIGIN to your frontend URL

# Start
pnpm start
```

Backend runs on `http://127.0.0.1:3000`.

**Serve frontend against backend:**

Remove or clear `window.DASHBOARD_STATIC_DATA_BASE_URL` in `frontend/assets/js/config.js`, then:

```bash
cd frontend
python3 -m http.server 8080
```

---

## Rebuild Demo Data

```bash
pnpm generate:nevada   # regenerate frontend/data/bootstrap.json
pnpm validate:data     # Rust validator — verifies source URLs, GeoJSON, key integrity
pnpm sitemap           # regenerate frontend/sitemap.xml from the route table
pnpm manifest          # regenerate frontend/data/manifest.json SHA-256 hashes
pnpm check             # full gate: JS + Rust (fmt/clippy/test) + data + backend audit
```

## Browser QA

```bash
pnpm install --ignore-scripts
python3 -m http.server 8091 --directory frontend
pnpm test:e2e
```

Set `E2E_URL=https://gov-budget.pages.dev` to run the same checks against the live Cloudflare Pages build.

---

## Bot Protection (Turnstile)

The feedback form supports Cloudflare Turnstile. It's disabled by default (`TURNSTILE_SITE_KEY = ""`).

To enable:

1. Create a Cloudflare API token with `Account > Turnstile > Edit` permission
2. Run the setup script:
   ```bash
   CF_API_TOKEN=your-token ./tools/setup-turnstile.sh
   ```
3. Redeploy:
   ```bash
   pnpm deploy:pages
   ```

---

## Deployment

Hosted on Cloudflare Pages. The `frontend/` directory is the publish root.

```bash
pnpm deploy:pages
```

- Security headers in `frontend/_headers` (CSP, HSTS, Permissions-Policy, etc.)
- See `docs/cloudflare-security-hardening.md` for full deployment checklist

---

## Data Sources

- [USAspending.gov](https://usaspending.gov) — federal awards, FY 2026
- [Census TIGERweb](https://tigerweb.geo.census.gov) — county and jurisdiction boundaries

Review tiers are amount-volume signals derived from the source data, not allegations.

---

## Feedback

Use the in-app **Feedback** button to open a prefilled GitHub Issue. Feedback stays free, public, and auditable.

---

## License

Data is from public government sources. Code is provided as-is for public interest use.
