/**
 * Nevada State Checkbook ingestion
 *
 * Source: Nevada Open Finance Portal (checkbook.nv.gov)
 * API: nevada-prod.spending.socrata.com (public, no key required)
 *
 * FY 2025 snapshot: $30.96B, 2.49M transactions, 108 agencies
 *
 * API endpoints:
 *   GET /api/chart_data.json?year=YYYY&entity_field=org2  → agencies ranked by spend
 *   GET /api/checkbook_data.json?year=YYYY&limit=N&offset=N → individual transactions
 *   GET /api/historic_spending.json → monthly spend by year (all years)
 *   GET /api/all_years.json → available fiscal years
 */

import { fetchJson, loadBootstrap, saveBootstrap, saveRaw, DRY_RUN, FISCAL_YEAR } from "./common.mjs";

const BASE = "https://nevada-prod.spending.socrata.com";
const YEAR = FISCAL_YEAR; // default "2026" override to "2025" since 2026 data is partial

// Nevada uses FY ending in July — FY 2025 = Jul 2024–Jun 2025
// API uses calendar year of the FY end, so "2025" = FY 2025
const API_YEAR = String(Number(YEAR) <= 2026 ? 2025 : YEAR); // FY 2026 data still partial

async function run() {
  console.log(`[nevada-state-checkbook] Fetching FY ${API_YEAR} from checkbook.nv.gov...`);

  // 1. Get all agencies sorted by spend
  const agencyData = await fetchJson(`${BASE}/api/chart_data.json?year=${API_YEAR}&entity_field=org2`);
  const agencies = (agencyData.records || []).filter(r => r.total > 0);
  console.log(`  Found ${agencies.length} agencies, total $${(agencies.reduce((s,a)=>s+a.total,0)/1e9).toFixed(2)}B`);

  // 2. Get top-50 vendors for sample transactions
  const txData = await fetchJson(`${BASE}/api/checkbook_data.json?year=${API_YEAR}&limit=200`);
  const transactions = txData.data || [];
  console.log(`  Fetched ${transactions.length} sample transactions`);

  // 3. Get historic monthly spend
  const historic = await fetchJson(`${BASE}/api/historic_spending.json`);
  const fyHistoric = (historic || []).filter(r => r.fiscal_year === API_YEAR);

  // Build raw snapshot
  const raw = {
    source: "nevada-prod.spending.socrata.com",
    fiscalYear: API_YEAR,
    fetchedAt: new Date().toISOString(),
    agencies,
    sampleTransactions: transactions,
    historicMonthly: fyHistoric,
    totals: {
      totalAmount: txData.total_amount,
      totalTransactions: txData.count,
    },
  };

  await saveRaw("nevada-state-checkbook", `raw-fy${API_YEAR}.json`, raw);

  if (DRY_RUN) {
    console.log("[nevada-state-checkbook] DRY RUN — skipping bootstrap update");
    return;
  }

  // Merge into bootstrap.json province data
  const bootstrap = await loadBootstrap();

  // Find Nevada province
  const pv = bootstrap.provinceView;
  if (!pv) { console.warn("  No provinceView in bootstrap — skipping merge"); return; }

  const nevadaProv = (pv.provinces || []).find(p =>
    p.stateCode === "NV" || p.id === "NV" || p.name === "Nevada" || p.displayName === "Nevada"
  );
  if (!nevadaProv) { console.warn("  Nevada province not found in bootstrap — skipping merge"); return; }

  // Build packages from top agencies (>$10M spend)
  const statePackages = agencies
    .filter(a => a.total >= 10_000_000)
    .slice(0, 50)
    .map((a, i) => ({
      id: `nv-state-agency-${i + 1}`,
      packageName: titleCase(a.key),
      owner: "State of Nevada",
      office: "Nevada State Controller's Office",
      budget: Math.round(a.total),
      totalPotentialWaste: Math.round(a.total * 0.003), // 0.3% review signal — placeholder
      riskScore: 2,
      severity: a.total > 1_000_000_000 ? "High" : a.total > 100_000_000 ? "Medium" : "Low",
      isPriority: a.total > 500_000_000,
      reviewReason: "State agency expenditure — priority review for contracts >$1M",
      sourceUrl: `https://nevada-prod.spending.socrata.com/#!/year/${API_YEAR}/explore/0/level_1`,
    }));

  nevadaProv.stateCheckbook = {
    source: "checkbook.nv.gov",
    apiBase: BASE,
    fiscalYear: API_YEAR,
    totalAmount: txData.total_amount,
    totalTransactions: txData.count,
    agencyCount: agencies.length,
    lastUpdated: new Date().toISOString(),
    topAgencies: agencies.slice(0, 15).map(a => ({
      name: titleCase(a.key),
      amount: Math.round(a.total),
    })),
    packages: statePackages,
  };

  // Update coverage note now that we have real data
  nevadaProv.coverageNote =
    `FY ${API_YEAR} includes Nevada state checkbook ($${(txData.total_amount / 1e9).toFixed(1)}B, ${agencies.length} agencies) from checkbook.nv.gov. ` +
    `Federal awards from USAspending.gov. County, city, and district sources are in progress.`;

  // Register this source in sourceMeta so bootstrap reflects all data origins
  if (!bootstrap.sourceMeta.sources) bootstrap.sourceMeta.sources = [];
  if (!bootstrap.sourceMeta.sources.includes(BASE)) {
    bootstrap.sourceMeta.sources.push(BASE);
  }

  await saveBootstrap(bootstrap);
  console.log(`[nevada-state-checkbook] ✅ Merged ${statePackages.length} agency packages into province data`);
}

function titleCase(str) {
  return str.replace(/\w+/g, w =>
    w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()
  );
}

run().catch(e => { console.error("[nevada-state-checkbook] FAILED:", e.message); process.exit(1); });
