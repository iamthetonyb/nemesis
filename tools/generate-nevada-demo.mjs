const FY_START = "2025-10-01";
const FY_END = "2026-09-30";
const STATE_CODE = "32";
const STATE_ABBR = "NV";
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";
const USASPENDING = "https://api.usaspending.gov/api/v2";

const zeroMetrics = () => ({
  totalPackages: 0,
  totalPriorityPackages: 0,
  totalPotentialWaste: 0,
  totalBudget: 0,
});

const ascii = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (value) =>
  ascii(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bMc([a-z])/g, (_match, char) => `Mc${char.toUpperCase()}`);

const amount = (value) => Number(Number(value || 0).toFixed(2));

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return payload;
}

async function postJson(path, body) {
  return fetchJson(`${USASPENDING}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function tigerLayer(layerId, where, outFields) {
  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: "true",
    f: "geojson",
    outSR: "4326",
    geometryPrecision: "4",
    maxAllowableOffset: "0.02",
  });
  return fetchJson(`${TIGER}/${layerId}/query?${params.toString()}`);
}

async function spendingCategory(category) {
  const rows = [];
  let page = 1;
  while (page) {
    const payload = await postJson(`/search/spending_by_category/${category}/`, {
      filters: {
        time_period: [{ start_date: FY_START, end_date: FY_END }],
        place_of_performance_locations: [{ country: "USA", state: STATE_ABBR }],
      },
      page,
      subawards: false,
    });
    rows.push(...(payload.results || []));
    page = payload.page_metadata?.hasNext ? payload.page_metadata.next : null;
  }
  return rows;
}

async function spendingAwards(awardTypeCodes, limit) {
  const payload = await postJson("/search/spending_by_award/", {
    filters: {
      time_period: [{ start_date: FY_START, end_date: FY_END }],
      place_of_performance_locations: [{ country: "USA", state: STATE_ABBR }],
      award_type_codes: awardTypeCodes,
    },
    fields: [
      "Award ID",
      "Recipient Name",
      "Award Amount",
      "Start Date",
      "End Date",
      "Awarding Agency",
      "Awarding Sub Agency",
      "Description",
      "generated_internal_id",
      "Place of Performance State Code",
      "Place of Performance County Name",
      "Place of Performance Congressional District",
    ],
    page: 1,
    limit,
    sort: "Award Amount",
    order: "desc",
    subawards: false,
  });
  return payload.results || [];
}

function tier(value) {
  if (value >= 5_000_000_000) return "absurd";
  if (value >= 500_000_000) return "high";
  if (value >= 50_000_000) return "med";
  return "low";
}

function score(value) {
  const level = tier(value);
  if (level === "absurd") return 4;
  if (level === "high") return 3;
  if (level === "med") return 2;
  return 1;
}

function severityCounts(value) {
  const counts = { low: 0, med: 0, high: 0, absurd: 0 };
  if (value > 0) counts[tier(value)] = 1;
  return counts;
}

function mergeSeverityCounts(rows) {
  return rows.reduce(
    (acc, row) => {
      const counts = row.severityCounts || {};
      acc.low += Number(counts.low || 0);
      acc.med += Number(counts.med || 0);
      acc.high += Number(counts.high || 0);
      acc.absurd += Number(counts.absurd || 0);
      return acc;
    },
    { low: 0, med: 0, high: 0, absurd: 0 }
  );
}

function metrics(value) {
  const numeric = amount(value);
  return {
    totalPackages: numeric > 0 ? 1 : 0,
    totalPriorityPackages: numeric > 0 ? 1 : 0,
    totalPotentialWaste: numeric,
    totalBudget: numeric,
  };
}

function regionRecord({ key, code, name, type, feature, value }) {
  const m = metrics(value);
  return {
    regionKey: key,
    code,
    provinceName: "Nevada",
    regionName: name,
    regionType: type,
    displayName: name,
    totalPackages: m.totalPackages,
    totalPriorityPackages: m.totalPriorityPackages,
    totalFlaggedPackages: m.totalPriorityPackages,
    totalPotentialWaste: m.totalPotentialWaste,
    totalBudget: m.totalBudget,
    avgRiskScore: value > 0 ? score(value) : 0,
    maxRiskScore: value > 0 ? score(value) : 0,
    ownerMix: { central: m.totalPackages, provinsi: 0, kabkota: 0, other: 0 },
    ownerMetrics: {
      central: m,
      provinsi: zeroMetrics(),
      kabkota: zeroMetrics(),
      other: zeroMetrics(),
    },
    severityCounts: severityCounts(value),
    dominantOwnerType: "central",
    geometrySource: feature?.properties?.GEOID || code,
  };
}

function aggregatePackage({ id, name, value, type, regionKey, regionName, sourcePath }) {
  return {
    id,
    sourceId: `${USASPENDING}${sourcePath}`,
    packageName: name,
    ownerName: "USAspending.gov Federal Aggregate",
    ownerType: "central",
    satker: type,
    locationRaw: `${regionName}, Nevada`,
    budget: amount(value),
    fundingSource: "Federal obligations",
    procurementType: "Official aggregate",
    procurementMethod: "USAspending category endpoint",
    selectionDate: FY_END,
    audit: {
      schemaVersion: "usas_category_fy2026_nv",
      severity: tier(value),
      potensiPemborosan: amount(value),
      reason:
        `Official USAspending FY2026 place-of-performance aggregate for ${regionName}. ` +
        "Amount is a source review amount and is not a waste finding.",
      flags: { isMencurigakan: false, isPemborosan: false },
    },
    meta: { isPriority: true, isFlagged: false, riskScore: score(value), activeTagCount: 1, mappedRegionCount: 1 },
    regionKeys: [regionKey],
    provinceKeys: ["state-nv"],
  };
}

function awardPackage(row, index) {
  const value = amount(row["Award Amount"]);
  const generatedId = ascii(row.generated_internal_id);
  const awardId = ascii(row["Award ID"]);
  const recipient = ascii(row["Recipient Name"]);
  const agency = ascii(row["Awarding Agency"]);
  const subAgency = ascii(row["Awarding Sub Agency"]);
  const description = ascii(row.Description).slice(0, 420);
  const district = ascii(row["Place of Performance Congressional District"]);
  const districtKey = district && district !== "90" ? `district-nv-${district.padStart(2, "0")}` : "district-nv-90";

  return {
    id: `usas-award-${index + 1}-${awardId}`,
    sourceId: generatedId ? `https://www.usaspending.gov/award/${generatedId}` : "https://www.usaspending.gov/",
    packageName: `${awardId}: ${description || "Federal award in Nevada"}`,
    ownerName: agency || "Federal Agency",
    ownerType: "central",
    satker: `${subAgency || "Federal award"} | ${recipient || "Recipient unavailable"}`,
    locationRaw: "Nevada statewide or source-level place of performance",
    budget: value,
    fundingSource: "Federal award",
    procurementType: generatedId.startsWith("ASST") ? "Assistance award" : "Contract award",
    procurementMethod: "USAspending award search",
    selectionDate: ascii(row["Start Date"]) || FY_END,
    audit: {
      schemaVersion: "usas_award_fy2026_nv",
      severity: tier(value),
      potensiPemborosan: value,
      reason:
        `Official USAspending award row. Recipient: ${recipient || "n/a"}. ` +
        `Period: ${ascii(row["Start Date"]) || "n/a"} to ${ascii(row["End Date"]) || "n/a"}. ` +
        "Review tier is amount-volume only and is not an allegation.",
      flags: { isMencurigakan: false, isPemborosan: false },
    },
    meta: { isPriority: true, isFlagged: false, riskScore: score(value), activeTagCount: 1, mappedRegionCount: 1 },
    regionKeys: [districtKey],
    provinceKeys: ["state-nv"],
  };
}

function ownerListsFromAwards(packages) {
  const grouped = new Map();
  for (const item of packages) {
    const key = item.ownerName || "Federal Agency";
    const current =
      grouped.get(key) ||
      {
        ownerType: "central",
        ownerName: key,
        totalPackages: 0,
        totalPriorityPackages: 0,
        totalFlaggedPackages: 0,
        totalPotentialWaste: 0,
        totalBudget: 0,
        severityCounts: { low: 0, med: 0, high: 0, absurd: 0 },
      };
    current.totalPackages += 1;
    current.totalPriorityPackages += 1;
    current.totalPotentialWaste = amount(current.totalPotentialWaste + item.budget);
    current.totalBudget = amount(current.totalBudget + item.budget);
    current.severityCounts[item.audit.severity] += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.totalPotentialWaste - a.totalPotentialWaste);
}

function geometryFeature(feature, properties) {
  return {
    type: "Feature",
    geometry: feature.geometry,
    properties,
  };
}

async function main() {
  const [countyGeo, stateGeo, districtGeo, counties, districts, contractAwards, grantAwards] = await Promise.all([
    tigerLayer(82, `STATE='${STATE_CODE}'`, "GEOID,NAME,STATE,COUNTY"),
    tigerLayer(80, `STATE='${STATE_CODE}'`, "GEOID,NAME,STATE,STUSAB"),
    tigerLayer(54, `STATE='${STATE_CODE}'`, "GEOID,NAME,BASENAME,CD119,STATE"),
    spendingCategory("county"),
    spendingCategory("district"),
    spendingAwards(["A", "B", "C", "D"], 10),
    spendingAwards(["02", "03", "04", "05"], 10),
  ]);

  const countyAmounts = new Map(counties.map((row) => [ascii(row.code), amount(row.amount)]));
  const districtAmounts = new Map(districts.map((row) => [ascii(row.code), amount(row.amount)]));
  const stateFeature = stateGeo.features[0];

  const countyFeatures = countyGeo.features
    .map((feature) => {
      const countyCode = ascii(feature.properties.COUNTY);
      const name = titleCase(feature.properties.NAME);
      const key = `county-nv-${countyCode}`;
      return {
        feature: geometryFeature(feature, {
          regionKey: key,
          code: `US-NV-${countyCode}`,
          provinceName: "Nevada",
          regionName: name,
          regionType: "County",
          displayName: name,
        }),
        region: regionRecord({
          key,
          code: `US-NV-${countyCode}`,
          name,
          type: "County",
          feature,
          value: countyAmounts.get(countyCode) || 0,
        }),
      };
    })
    .sort((a, b) => b.region.totalPotentialWaste - a.region.totalPotentialWaste);

  const districtFeatures = districtGeo.features
    .map((feature) => {
      const cd = ascii(feature.properties.CD119);
      const name = `Nevada Congressional District ${Number(cd)}`;
      const key = `district-nv-${cd}`;
      return {
        feature: geometryFeature(feature, {
          regionKey: key,
          code: `US-NV-CD-${cd}`,
          provinceName: "Nevada",
          regionName: name,
          regionType: "District",
          displayName: name,
        }),
        region: regionRecord({
          key,
          code: `US-NV-CD-${cd}`,
          name,
          type: "District",
          feature,
          value: districtAmounts.get(cd) || 0,
        }),
      };
    })
    .sort((a, b) => a.region.code.localeCompare(b.region.code));

  const multipleDistrictAmount = districtAmounts.get("90") || 0;
  const multipleDistrict = {
    feature: geometryFeature(stateFeature, {
      regionKey: "district-nv-90",
      code: "US-NV-CD-90",
      provinceName: "Nevada",
      regionName: "Nevada Multiple Congressional Districts",
      regionType: "District",
      displayName: "NV Multiple Districts",
    }),
    region: regionRecord({
      key: "district-nv-90",
      code: "US-NV-CD-90",
      name: "Nevada Multiple Congressional Districts",
      type: "District",
      feature: stateFeature,
      value: multipleDistrictAmount,
    }),
  };

  const regionEntries = [...countyFeatures, ...districtFeatures, multipleDistrict];
  const countyPackages = countyFeatures.map(({ region }) =>
    aggregatePackage({
      id: `usas-county-${region.code}`,
      name: `Federal FY2026 obligations: ${region.displayName}`,
      value: region.totalBudget,
      type: "Place-of-performance county",
      regionKey: region.regionKey,
      regionName: region.displayName,
      sourcePath: "/search/spending_by_category/county/",
    })
  );
  const districtPackages = [...districtFeatures, multipleDistrict].map(({ region }) =>
    aggregatePackage({
      id: `usas-district-${region.code}`,
      name: `Federal FY2026 obligations: ${region.displayName}`,
      value: region.totalBudget,
      type: "Place-of-performance congressional district",
      regionKey: region.regionKey,
      regionName: region.displayName,
      sourcePath: "/search/spending_by_category/district/",
    })
  );
  const awardPackages = [...contractAwards, ...grantAwards].map(awardPackage);
  const packageSamples = [...countyPackages, ...districtPackages, ...awardPackages];

  const countyTotal = amount(countyFeatures.reduce((sum, item) => sum + item.region.totalBudget, 0));
  const provinceSeverity = mergeSeverityCounts(regionEntries.map((item) => item.region));
  const province = {
    provinceKey: "state-nv",
    code: "NV",
    provinceName: "Nevada",
    regionName: "Nevada",
    regionType: "State",
    displayName: "Nevada",
    totalPackages: packageSamples.length,
    totalPriorityPackages: packageSamples.length,
    totalFlaggedPackages: 0,
    totalPotentialWaste: countyTotal,
    totalBudget: countyTotal,
    avgRiskScore: 2.4,
    maxRiskScore: 4,
    ownerMix: { central: packageSamples.length, provinsi: 0, kabkota: 0, other: 0 },
    ownerMetrics: {
      central: {
        totalPackages: packageSamples.length,
        totalPriorityPackages: packageSamples.length,
        totalPotentialWaste: countyTotal,
        totalBudget: countyTotal,
      },
      provinsi: zeroMetrics(),
      kabkota: zeroMetrics(),
      other: zeroMetrics(),
    },
    severityCounts: provinceSeverity,
    dominantOwnerType: "central",
  };

  const bootstrap = {
    sourceMeta: {
      mode: "nevada-official-demo",
      notice:
        "Nevada-first static demo generated from official USAspending API slices and U.S. Census TIGERweb boundaries. Review amounts are source amounts, not allegations.",
      fiscalYear: "FY 2026",
      generatedAt: new Date().toISOString(),
      sources: [
        "https://api.usaspending.gov/docs/",
        "https://api.usaspending.gov/api/v2/search/spending_by_category/county/",
        "https://api.usaspending.gov/api/v2/search/spending_by_category/district/",
        "https://api.usaspending.gov/api/v2/search/spending_by_award/",
        `${TIGER}`,
      ],
    },
    summary: {
      totalPackages: packageSamples.length,
      totalPriorityPackages: packageSamples.length,
      totalPotentialWaste: countyTotal,
      totalBudget: countyTotal,
      unmappedPackages: 0,
      multiLocationPackages: multipleDistrictAmount > 0 ? 1 : 0,
    },
    legend: {
      zeroColor: "#17130a",
      ranges: [
        { key: "band-1", color: "#8f7b3d", min: 1, max: 50_000_000 },
        { key: "band-2", color: "#d4af37", min: 50_000_000.01, max: 250_000_000 },
        { key: "band-3", color: "#e4c681", min: 250_000_000.01, max: 2_000_000_000 },
        { key: "band-4", color: "#b35a36", min: 2_000_000_000.01, max: 8_000_000_000 },
      ],
    },
    geo: {
      type: "FeatureCollection",
      features: regionEntries.map((item) => item.feature),
    },
    regions: regionEntries.map((item) => item.region),
    provinceView: {
      legend: {
        zeroColor: "#17130a",
        ranges: [{ key: "band-1", color: "#d4af37", min: 1, max: countyTotal }],
      },
      geo: {
        type: "FeatureCollection",
        features: [
          geometryFeature(stateFeature, {
            provinceKey: "state-nv",
            code: "NV",
            provinceName: "Nevada",
            displayName: "Nevada",
            regionType: "State",
          }),
        ],
      },
      provinces: [province],
    },
    ownerLists: {
      central: ownerListsFromAwards(awardPackages),
    },
    packageSamples,
  };

  process.stdout.write(`${JSON.stringify(bootstrap, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
