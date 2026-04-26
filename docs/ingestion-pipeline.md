# Ingestion Pipeline

The dashboard updates automatically via GitHub Actions. No server required. Data flows from official APIs through a Rust validation gate to Cloudflare Pages.

## Flow

```
generate-nevada-demo.mjs (federal baseline: USAspending + TIGERweb)
  → tools/ingest/*.mjs (augment: state checkbook, counties, cities, districts)
  → bootstrap.json
  → cargo run -p spending-validate (hard gate)
  → cargo run -p spending-manifest (public SHA-256 manifest)
  → git commit → Cloudflare Pages deploy
```

**Order matters:** the federal baseline runs first, then ingest scripts augment it.
Running ingest before generate would overwrite the augmented data.

## Automated Schedule

**Workflow:** `.github/workflows/ingest-nevada.yml`  
**Trigger:** Weekly Monday 8 AM UTC (`0 8 * * 1`) + manual dispatch  
**Runtime:** GitHub Actions (Ubuntu), free for public repos  

The workflow:
1. Generates `bootstrap.json` from federal sources (USAspending + TIGERweb)
2. Runs each augmentation script (failures are non-fatal individually)
3. Runs the Rust validator — **hard gate**: if validation fails, nothing commits
4. Generates and verifies `frontend/data/manifest.json`
5. Commits + pushes only if bootstrap.json or manifest.json changed
6. Cloudflare Pages auto-deploys on push (enable GitHub integration in CF dashboard)

**Result:** Data stays fresh forever with no VPS, no cron daemon, no manual work.

---

## Adding a New Source

1. Create `tools/ingest/nevada-{source}.mjs` (copy an existing stub as template)
2. Document the source in `docs/data-sources/`
3. Add a step to `.github/workflows/ingest-nevada.yml` (copy an existing step)
4. Test locally: `node tools/ingest/nevada-{source}.mjs`
5. Run `pnpm validate:data` to confirm output passes the Rust gate

---

## Running Locally

```bash
# Full refresh: federal baseline + state checkbook (all live sources)
pnpm ingest:nevada

# Federal baseline only (USAspending + TIGERweb)
pnpm generate:nevada

# Single augmentation source (reads existing bootstrap.json)
node tools/ingest/nevada-state-checkbook.mjs

# Dry run (validate only, do not write files)
INGEST_DRY_RUN=true node tools/ingest/nevada-state-checkbook.mjs

# Validate after any ingestion
pnpm validate:data

# Regenerate public artifact hash manifest
pnpm manifest

# Full gate (JS syntax + Rust + validate + backend audit)
pnpm check
```

---

## Manual Dispatch

Run a specific subset of sources from GitHub Actions:
1. GitHub → Actions → Nevada Data Refresh → Run workflow
2. Set `sources` input: `state` | `las-vegas` | `ccsd` | `counties` | `districts` | (empty = all)
3. Set `dry_run: true` to validate without committing

---

## Data Retention

Raw snapshots are stored in `data/raw/{source}/{file}-fy{year}.json`.  
This directory is in `.gitignore` — raw files stay local / on the Actions runner.  
Only `frontend/data/bootstrap.json` is committed to the repo.

`frontend/data/manifest.json` is also committed. It lists each public frontend artifact,
its byte length, and its SHA-256 digest so anyone can verify the deployed files.

For long-term archiving: store raw snapshots in Cloudflare R2 or Backblaze B2.  
See `docs/free-tier-and-security-strategy.md` for the R2 setup plan.

---

## Cloudflare Pages GitHub Integration (Required for Auto-Deploy)

To enable automatic deployment on every data commit:
1. Cloudflare Dashboard → Pages → gov-budget → Settings → Builds & Deployments
2. Connect to Git → Select the USAspend repo
3. Build configuration: Output directory = `frontend`, Build command = (none)
4. Save

After this, every push to `main` (including bot data commits) triggers a Cloudflare deploy automatically. No `wrangler pages deploy` step needed in the workflow.

---

## Historical Data Strategy

Current: single `bootstrap.json` for FY 2026.

Future multi-year support:
- Generate `frontend/data/bootstrap-{year}.json` per fiscal year
- Keep `bootstrap.json` as a symlink/copy of the current year
- UI year selector (`<select>` in header) fetches the chosen year's file
- GitHub Actions ingests the current year; historical years are archived

The `sourceMeta.fiscalYear` field in bootstrap.json identifies which year the data covers.  
The `sourceMeta.generatedAt` field shows when the snapshot was last updated (displayed in UI).

---

## Validation Rules (Rust Gate)

The Rust validator (`crates/spending-validate/`) enforces:
- All source URLs must use HTTPS
- Source URLs must include `usaspending.gov` and `census.gov` (for federal-only mode)
- All region keys referenced in packages must exist in `regions[]`
- All province keys referenced in packages must exist in `provinceView.provinces[]`
- GeoJSON geometry: valid WGS84 coordinates, closed polygon rings
- No duplicate IDs in packages
- `summary.totalPackages` must equal `packageSamples.length`
- `manifest.json` paths, sizes, and SHA-256 hashes match the public frontend files

If validation fails, the GitHub Actions workflow aborts before committing.
