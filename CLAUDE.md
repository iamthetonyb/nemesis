# USA Spending Watch — CLAUDE.md

## Stack
- Frontend: plain HTML/CSS/JS (no build step, no bundler)
- Data plane: Rust for validation/ingestion/correctness-sensitive artifact work
- Backend: Node.js + Express 5 + better-sqlite3 (optional local API; not the long-term source-of-truth path)
- Deploy: Cloudflare Pages (frontend only for demo)
- Map: MapLibre GL JS v5 (CDN, SRI-pinned)

## Package Manager
- **pnpm only** across this repo — better-sqlite3 is a native C++ addon, pnpm handles it reliably
- Use `pnpm dlx` for one-off CLI packages
- Corepack enforces this via `"packageManager": "pnpm@10.33.0"` in root and backend package manifests
- Do not add Yarn, Bun, non-pnpm JS lockfiles, or Deno package management without a new ADR
- Cargo is only for Rust crates under `crates/`; root repo checks still run through `pnpm check`

## Runtime Decision
- Accepted direction: static Cloudflare frontend + Rust data plane
- Cloudflare Workers can be added later for small indexed APIs; Rust Workers via Wasm are allowed only when the endpoint benefits from Rust
- Deno is deferred until a specific ADR proves it reduces cost/complexity versus Cloudflare Workers or Rust CLI
- See `docs/architecture-runtime-decision.md`

## Security Rules
- CSP in `frontend/_headers` — update when adding new CDN sources
- SRI hashes on all CDN assets — recompute when upgrading versions
- No secrets in frontend code — TURNSTILE_SITE_KEY="" disables Turnstile safely
- All API inputs validated server-side; trust no query params
- Rate limiting on all /api/* routes (120 req/15min)

## Data Integrity
- All spending figures link to official USAspending.gov source records
- Labels: "review", "priority", "needs review" — never "fraud" or "waste"
- Review tiers = amount-volume signals, not allegations
- Static demo data in `frontend/data/bootstrap.json` — regenerate via `node tools/generate-nevada-demo.mjs`
- Validate public artifacts with `pnpm validate:data`

## Key Files
- `frontend/assets/js/config.js` — runtime config (static data URL + Turnstile key)
- `frontend/assets/js/app.js` — dashboard logic
- `frontend/assets/js/map.js` — MapLibre wrapper
- `frontend/_headers` — Cloudflare Pages security headers (CSP, HSTS, etc.)
- `backend/src/dashboard-repository.js` — all DB queries
- `crates/spending-validate/` — Rust validation gate for public dashboard artifacts
- `tools/setup-turnstile.sh` — one-shot Turnstile widget creation (needs CF_API_TOKEN)

## Cloudflare Setup
- Project: `gov-budget` on Cloudflare Pages
- Deploy: `pnpm deploy:pages`
- Turnstile: set TURNSTILE_SITE_KEY in `frontend/assets/js/config.js` after running setup-turnstile.sh
- WAF/Bot settings require a custom domain (zone) — deferred until usaspending.us added
