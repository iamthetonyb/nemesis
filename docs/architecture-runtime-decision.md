# Runtime Decision: Static Edge + Rust Data Plane

Status: accepted for the current roadmap.

## Final Consensus

Use a split architecture instead of rewriting everything into one runtime:

1. Public frontend stays static on Cloudflare Pages.
2. Public API, when needed, stays minimal on Cloudflare Workers.
3. Data ingestion, source validation, dedupe, joins, and artifact linting move toward Rust.
4. The existing Node/Express backend remains optional local tooling only until it is replaced by generated artifacts, D1 lookup tables, or Rust ingestion output.
5. Deno is not the primary runtime yet. Keep it as a possible future TypeScript scripting or edge experiment, but do not add a second deploy platform while Cloudflare Pages already works.

This keeps public hosting cheap and boring while moving the highest-trust data path toward a memory-safe compiled language.

## Toolchain Policy

Use two package managers, with clear ownership:

- `pnpm` owns JavaScript dependencies, deploy commands, and root repo orchestration.
- `cargo` owns Rust crates under `crates/`.

Do not add Yarn, Bun, non-pnpm JS lockfiles, Deno dependency files, or another package manager without a new ADR. Deno is a runtime choice, not a repo package-manager replacement. If Deno is adopted later, it must have its own reason and should not replace `pnpm` for existing Cloudflare/deploy scripts.

## Why Rust

Government secure-by-design guidance now pushes manufacturers toward memory-safe languages and memory-safety roadmaps. Rust gives this project:

- memory safety without a garbage collector
- strong type modeling for government records
- fast local validation over large CSV/JSON/GeoJSON/SQLite/Parquet files
- reproducible command-line tools for cron jobs and CI
- a path to WebAssembly Workers if edge logic ever needs Rust

Rust should own correctness-sensitive data jobs first:

- source manifest hashing
- schema validation
- source URL allowlists
- duplicate detection
- amount reconciliation against official totals
- boundary/jurisdiction linting
- static artifact generation

## Why Not Full Rust Everywhere Now

Full Rust frontend/backend rewrite is not the cheapest or safest next step:

- the current frontend is static and already public
- Cloudflare Pages serving static assets has the lowest free-tier risk
- Cloudflare Workers Rust runs through WebAssembly and still needs Worker platform glue
- a premature Rust API would add build and deploy complexity before the data pipeline is mature

Rust belongs in the data plane first, not in cosmetic UI state.

## Why Not Deno First

Deno is a solid TypeScript runtime, but it does not solve the main risk for this project: source accuracy and artifact integrity. It also adds another hosting surface if used through Deno Deploy.

Use Deno only if one of these becomes true:

- TypeScript ingestion scripts become cleaner in Deno than Node
- a Deno Deploy proof is cheaper or more reliable than Cloudflare for a specific edge endpoint
- the project chooses Fresh/Deno for a future app rewrite

Until then, avoid runtime sprawl.

## Node Boundary

Node remains acceptable for:

- the current static data generator
- optional local Express/SQLite inspection
- package/deploy orchestration through pnpm

Node should not become the long-term source-of-truth data pipeline. New high-trust ingestion and validation code should be Rust unless there is a concrete reason not to.

## Target Layout

```text
frontend/                  static public UI
backend/                   optional local API, sunset over time
crates/spending-validate/  Rust public artifact validator
crates/ingest-us/          future Rust source ingestion CLI
crates/source-manifest/    future Rust hashing + provenance CLI
data/raw/                  future private source snapshots, not committed
data/build/                future generated local artifacts, not committed
frontend/data/             public sanitized artifacts
```

## Migration Gates

Before adding a public API:

- static JSON shards are too large or too slow
- indexed lookup materially improves UX
- D1/Worker requests stay inside free-tier expectations

Before replacing Node scripts:

- Rust validator is stable in `pnpm check`
- source manifests exist
- one Nevada source can be ingested end-to-end in Rust
- generated totals reconcile against official published totals

Before adding Deno:

- write a one-page ADR showing why Cloudflare Workers or Rust CLI is not enough
- prove it does not add cost or operational burden

## Current Prep

The repo now includes a Rust workspace and `spending-validate` CLI. `pnpm check` runs JavaScript syntax checks, Rust formatting/linting/checks, data validation, and backend production dependency audit.

## References

- CISA Product Security Bad Practices: https://www.cisa.gov/resources-tools/resources/product-security-bad-practices
- CISA/NSA Memory Safe Languages guidance: https://www.cisa.gov/resources-tools/resources/memory-safe-languages-reducing-vulnerabilities-modern-software-development
- Cloudflare Workers Rust docs: https://developers.cloudflare.com/workers/languages/rust/
- Cloudflare Workers Wasm docs: https://developers.cloudflare.com/workers/runtime-apis/webassembly/
- Deno Deploy usage guidelines: https://docs.deno.com/deploy/usage/
