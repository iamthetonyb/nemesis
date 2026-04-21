(() => {
  const API_BASE_URL = (window.DASHBOARD_API_BASE_URL || "http://127.0.0.1:3000/api").replace(/\/$/, "");
  const STATIC_DATA_BASE_URL = window.DASHBOARD_STATIC_DATA_BASE_URL
    ? String(window.DASHBOARD_STATIC_DATA_BASE_URL).replace(/\/$/, "")
    : "";

  if (!window.maplibregl || !window.AuditMap) {
    console.error("MapLibre GL or AuditMap failed to load.");
    return;
  }

  const state = {
    mapFilter: "all",
    tab: "county",
    selectedAreaKey: null,
    selectedOwnerKey: null,
    search: "",
    sortBy: "waste",
    modalRequestId: 0,
    modal: {
      areaType: "region",
      areaKey: null,
      ownerName: "",
      page: 1,
      pageSize: 25,
      search: "",
      ownerType: "",
      severity: "",
      priorityOnly: false,
    },
  };

  const dom = {
    kpi: document.getElementById("kpi"),
    mapRoot: document.getElementById("map"),
    mapFilters: document.getElementById("mf"),
    tabs: document.getElementById("tabs"),
    legend: document.getElementById("legend"),
    sidebarContent: document.getElementById("sbc"),
    modal: document.getElementById("rupModal"),
    modalTop: document.getElementById("modalTop"),
    modalBody: document.getElementById("modalBody"),
  };

  if (Object.values(dom).some((element) => !element)) {
    console.error("Dashboard shell is incomplete.");
    return;
  }

  const FILTERS = [
    { key: "all", label: "All Sources" },
    { key: "central", label: "Federal" },
    { key: "provinsi", label: "State" },
    { key: "kabkota", label: "Local / District" },
    { key: "other", label: "Others" },
  ];

  const TABS = [
    { key: "all", label: "All" },
    { key: "county", label: "County" },
    { key: "city", label: "City / Ward" },
    { key: "district", label: "District" },
  ];

  const SEVERITY_FILTERS = [
    { key: "", label: "All Tiers" },
    { key: "low", label: "Low Volume" },
    { key: "med", label: "Medium Volume" },
    { key: "high", label: "High Volume" },
    { key: "absurd", label: "Extreme Volume" },
  ];

  let dashboardData = null;
  let regionsByKey = new Map();
  let provincesByKey = new Map();
  let turnstileLoadPromise = null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeJsString(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
  }

  function jsArg(value) {
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "number") {
      return String(value);
    }
    return `'${escapeJsString(value)}'`;
  }

  function actionCall(action, ...args) {
    return escapeAttr(`dashboardActions.${action}(${args.map(jsArg).join(",")})`);
  }

  function actionExpr(expression) {
    return escapeAttr(expression);
  }

  function normalizeSourceId(sourceId) {
    if (sourceId === null || sourceId === undefined) {
      return null;
    }

    const normalized = String(sourceId).trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }

    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return null;
    }

    return String(parsed);
  }

  function buildSourceUrl(sourceId) {
    if (typeof sourceId === "string" && /^https?:\/\//i.test(sourceId)) {
      return sourceId;
    }

    return null;
  }

  function isProvinceView() {
    return state.mapFilter === "provinsi";
  }

  function isCentralOwnerMode() {
    return state.mapFilter === "central";
  }

  function currentAreaType() {
    return isProvinceView() ? "province" : "region";
  }

  function formatCompactCurrency(value) {
    const amount = Number(value) || 0;
    const abs = Math.abs(amount);
    if (abs >= 1e12) return `${(amount / 1e12).toFixed(amount % 1e12 === 0 ? 0 : 1)} T`;
    if (abs >= 1e9) return `${(amount / 1e9).toFixed(amount % 1e9 === 0 ? 0 : 1)} B`;
    if (abs >= 1e6) return `${(amount / 1e6).toFixed(amount % 1e6 === 0 ? 0 : 1)} M`;
    if (abs >= 1e3) return `${(amount / 1e3).toFixed(amount % 1e3 === 0 ? 0 : 1)} K`;
    return `${amount.toFixed(0)}`;
  }

  function formatCurrencyLong(value) {
    const number = Math.round(Number(value) || 0);
    return `$${number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  }

  function formatNumber(value) {
    const number = Math.round(Number(value) || 0);
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatDecimal(value) {
    const amount = Number(value) || 0;
    return amount % 1 === 0 ? formatNumber(amount) : amount.toFixed(2);
  }

  function ownerTypeLabel(value) {
    if (value === "central") return "Federal";
    if (value === "provinsi") return "State";
    if (value === "kabkota") return "Local / District";
    if (value === "other") return "Others";
    return "Unknown";
  }

  function ownerTypeCount(area, ownerType) {
    return Number(area && area.ownerMix ? area.ownerMix[ownerType] : 0) || 0;
  }

  function ownerMixSummary(area) {
    return `Federal ${formatNumber(ownerTypeCount(area, "central"))} | State ${formatNumber(
      ownerTypeCount(area, "provinsi")
    )} | Local ${formatNumber(ownerTypeCount(area, "kabkota"))} | Others ${formatNumber(
      ownerTypeCount(area, "other")
    )}`;
  }

  function areaOwnerSummary(area) {
    return getActiveSidebarOwnerKey() ? `${activeSidebarOwnerLabel()} only` : ownerMixSummary(area);
  }

  function areaBadgeLabel(area) {
    if (area.regionType === "Provinsi" || area.regionType === "State") return "State";
    if (area.regionType === "District") return "District";
    if (area.regionType === "School District") return "School";
    if (area.regionType === "Special District") return "Special";
    if (area.regionType === "Authority") return "Authority";
    if (area.regionType === "Ward") return "Ward";
    if (area.regionType === "City") return "City";
    return "County";
  }

  function areaBadgeClass(area) {
    return area.regionType === "Ward" ||
      area.regionType === "City" ||
      area.regionType === "District" ||
      area.regionType === "School District" ||
      area.regionType === "Special District" ||
      area.regionType === "Authority" ||
      area.regionType === "Kota"
      ? "bk"
      : "bp";
  }

  function areaSecondaryLine(area) {
    return isProvinceView() ? "State-level records only" : area.provinceName;
  }

  function severityColor(severity) {
    if (severity === "absurd") return "var(--rose)";
    if (severity === "high") return "var(--brick)";
    if (severity === "med") return "var(--olive)";
    return "var(--steel)";
  }

  function severityLabel(severity) {
    if (severity === "absurd") return "Extreme Volume";
    if (severity === "high") return "High Volume";
    if (severity === "med") return "Medium Volume";
    return "Low Volume";
  }

  function totalAreaMetrics(area) {
    return {
      totalPackages: Number(area?.totalPackages) || 0,
      totalPriorityPackages: Number(area?.totalPriorityPackages) || 0,
      totalPotentialWaste: Number(area?.totalPotentialWaste) || 0,
      totalBudget: Number(area?.totalBudget) || 0,
    };
  }

  function getActiveSidebarOwnerKey() {
    return isProvinceView() ? "provinsi" : state.mapFilter === "all" ? "" : state.mapFilter;
  }

  function activeSidebarOwnerLabel() {
    const ownerKey = getActiveSidebarOwnerKey();
    return ownerKey ? ownerTypeLabel(ownerKey) : "All Sources";
  }

  function getAreaMetricsForOwner(area, ownerKey) {
    if (!area) {
      return totalAreaMetrics(null);
    }

    const metrics = area.ownerMetrics && area.ownerMetrics[ownerKey];

    if (metrics) {
      return {
        totalPackages: Number(metrics.totalPackages) || 0,
        totalPriorityPackages: Number(metrics.totalPriorityPackages) || 0,
        totalPotentialWaste: Number(metrics.totalPotentialWaste) || 0,
        totalBudget: Number(metrics.totalBudget) || 0,
      };
    }

    if (isProvinceView() && ownerKey === "provinsi") {
      return totalAreaMetrics(area);
    }

    return {
      totalPackages: ownerTypeCount(area, ownerKey),
      totalPriorityPackages: 0,
      totalPotentialWaste: 0,
      totalBudget: 0,
    };
  }

  function getSidebarAreaMetrics(area) {
    const ownerKey = getActiveSidebarOwnerKey();
    return ownerKey ? getAreaMetricsForOwner(area, ownerKey) : totalAreaMetrics(area);
  }

  function renderSeverityFilterOptions(selectedValue) {
    return SEVERITY_FILTERS.map(
      (filter) =>
        `<option value="${escapeAttr(filter.key)}"${selectedValue === filter.key ? " selected" : ""}>${escapeHtml(
          filter.label
        )}</option>`
    ).join("");
  }

  function getOwnerCardKey(ownerType, ownerName) {
    return `${ownerType}::${ownerName}`;
  }

  function getAreaKey(area, areaType = currentAreaType()) {
    return areaType === "province" ? area.provinceKey : area.regionKey;
  }

  function getAreaByKey(areaType, areaKey) {
    return (areaType === "province" ? provincesByKey : regionsByKey).get(areaKey) || null;
  }

  function getActiveAreaByKey(areaKey) {
    return getAreaByKey(currentAreaType(), areaKey);
  }

  function getActiveAreas() {
    return isProvinceView() ? dashboardData.provinceView.provinces : dashboardData.regions;
  }

  function getCentralOwnersForSidebar() {
    return dashboardData && dashboardData.ownerLists && Array.isArray(dashboardData.ownerLists.central)
      ? dashboardData.ownerLists.central
      : [];
  }

  function getActiveGeo() {
    return isProvinceView() ? dashboardData.provinceView.geo : dashboardData.geo;
  }

  function getActiveLegend() {
    return isProvinceView() ? dashboardData.provinceView.legend : dashboardData.legend;
  }

  function getFeatureAreaKey(feature) {
    return isProvinceView() ? feature.properties.provinceKey : feature.properties.regionKey;
  }

  function ensureMapStatus() {
    let status = document.getElementById("mapStatus");
    if (!status) {
      status = document.createElement("div");
      status.id = "mapStatus";
      status.className = "map-status";
      dom.mapRoot.parentElement.appendChild(status);
    }
    return status;
  }

  function setMapStatus(message, isError) {
    const status = ensureMapStatus();
    status.className = `map-status${isError ? " error" : ""}`;
    status.textContent = message;
  }

  function clearMapStatus() {
    const status = document.getElementById("mapStatus");
    if (status) {
      status.remove();
    }
  }

  function renderKpiCards(cards) {
    dom.kpi.innerHTML = cards
      .map(
        (item) =>
          `<div class="kc"><div class="kl">${escapeHtml(item.label)}</div><div class="kv">${escapeHtml(
            item.value
          )}</div><div class="ks">${escapeHtml(item.sublabel)}</div></div>`
      )
      .join("");
  }

  function renderSidebarMessage(message, isError) {
    dom.sidebarContent.innerHTML = `<div class="panel-msg${isError ? " error" : ""}">${escapeHtml(message)}</div>`;
  }

  function renderModalState(title, message, isError) {
    dom.modalTop.innerHTML =
      `<div class="modal-top-row"><div><h2>${escapeHtml(title)}</h2><div class="msub">Public spending review &middot; FY 2026</div></div>` +
      `<div style="display:flex;gap:8px;align-items:center"><button class="modal-close" onclick="${actionCall("closeRegionModal")}">&#10005; Close</button></div></div>`;
    dom.modalBody.innerHTML = `<div class="modal-state${isError ? " error" : ""}">${escapeHtml(message)}</div>`;
  }

  function renderBootstrapLoading() {
    renderKpiCards([
      { label: "Review Amount", value: "...", sublabel: "Loading source-faithful aggregates" },
      { label: "Priority Records", value: "...", sublabel: "Loading jurisdictions" },
      { label: "Budget Reviewed", value: "...", sublabel: "Preparing map layers" },
      { label: "Mapped Records", value: "...", sublabel: "Checking location coverage" },
    ]);
    renderSidebarMessage("Loading public spending review by area...", false);
    setMapStatus("Loading map...", false);
  }

  function renderBootstrapError(error) {
    console.error("Dashboard bootstrap failed:", error);
    renderKpiCards([
      { label: "Review Amount", value: "-", sublabel: "Data unavailable" },
      { label: "Priority Records", value: "-", sublabel: "Data unavailable" },
      { label: "Budget Reviewed", value: "-", sublabel: "Data unavailable" },
      { label: "Mapped Records", value: "-", sublabel: "Data unavailable" },
    ]);
    renderSidebarMessage("Dashboard data could not be loaded. Please try refreshing.", true);
    setMapStatus("Dashboard data unavailable.", true);
  }

  function formatFetchError(error) {
    return error instanceof Error ? error.message : String(error);
  }

  async function fetchJson(path) {
    const response = await fetch(`${API_BASE_URL}${path}`);
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        throw new Error(`Invalid JSON response from ${path}`);
      }
    }
    if (!response.ok) {
      throw new Error(payload && payload.error ? payload.error : `Request failed (${response.status})`);
    }
    return payload;
  }

  async function fetchStaticJson(path) {
    const response = await fetch(`${STATIC_DATA_BASE_URL}/${path.replace(/^\//, "")}`);
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        throw new Error(`Invalid static JSON response from ${path}`);
      }
    }
    if (!response.ok) {
      throw new Error(payload && payload.error ? payload.error : `Static request failed (${response.status})`);
    }
    return payload;
  }

  function normalizeDashboardData(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Bootstrap payload is invalid.");
    }

    return {
      summary: payload.summary || {
        totalPackages: 0,
        totalPriorityPackages: 0,
        totalPotentialWaste: 0,
        totalBudget: 0,
        unmappedPackages: 0,
        multiLocationPackages: 0,
      },
      legend: payload.legend || { zeroColor: "#17130a", ranges: [] },
      geo: payload.geo || { type: "FeatureCollection", features: [] },
      regions: Array.isArray(payload.regions) ? payload.regions : [],
      provinceView: {
        legend: (payload.provinceView && payload.provinceView.legend) || { zeroColor: "#17130a", ranges: [] },
        geo: (payload.provinceView && payload.provinceView.geo) || { type: "FeatureCollection", features: [] },
        provinces:
          payload.provinceView && Array.isArray(payload.provinceView.provinces) ? payload.provinceView.provinces : [],
      },
      ownerLists: {
        central: payload.ownerLists && Array.isArray(payload.ownerLists.central) ? payload.ownerLists.central : [],
      },
      packageSamples: Array.isArray(payload.packageSamples) ? payload.packageSamples : [],
      sourceMeta: payload.sourceMeta || null,
    };
  }

  function getLegendColor(value) {
    const legend = getActiveLegend();

    if (!legend) {
      return "#17130a";
    }

    if (!value || value <= 0) {
      return legend.zeroColor || "#17130a";
    }

    const range = (legend.ranges || []).find((item) => value >= item.min && value <= item.max);
    return range ? range.color : legend.ranges[legend.ranges.length - 1]?.color || "#b35a36";
  }

  function areaMatchesCurrentView(area) {
    if (!area) {
      return false;
    }

    if (isProvinceView()) {
      return area.totalPackages > 0;
    }

    if (state.tab === "county" && area.regionType !== "County") {
      return false;
    }

    if (state.tab === "city" && area.regionType !== "City" && area.regionType !== "Ward") {
      return false;
    }

    if (
      state.tab === "district" &&
      area.regionType !== "District" &&
      area.regionType !== "School District" &&
      area.regionType !== "Special District" &&
      area.regionType !== "Authority"
    ) {
      return false;
    }

    if (state.mapFilter === "all") {
      return (Number(area.totalPackages) || 0) > 0 || (Number(area.totalPotentialWaste) || 0) > 0;
    }

    if (FILTERS.some((filter) => filter.key === state.mapFilter)) {
      return ownerTypeCount(area, state.mapFilter) > 0;
    }

    return true;
  }

  function getFilteredAreasForSidebar() {
    let areas = getActiveAreas().filter((area) => areaMatchesCurrentView(area));

    if (state.search) {
      const query = state.search.toLowerCase();
      const activeOwnerQuery = activeSidebarOwnerLabel().toLowerCase();
      areas = areas.filter((area) => {
        const matchesName = area.displayName.toLowerCase().includes(query) || area.provinceName.toLowerCase().includes(query);

        if (isProvinceView()) {
          return matchesName;
        }

        return matchesName || activeOwnerQuery.includes(query);
      });
    }

    const metricsByAreaKey = new Map(areas.map((area) => [getAreaKey(area), getSidebarAreaMetrics(area)]));
    const sorters = {
      waste: (left, right) =>
        metricsByAreaKey.get(getAreaKey(right)).totalPotentialWaste - metricsByAreaKey.get(getAreaKey(left)).totalPotentialWaste,
      priority: (left, right) =>
        metricsByAreaKey.get(getAreaKey(right)).totalPriorityPackages - metricsByAreaKey.get(getAreaKey(left)).totalPriorityPackages,
      packages: (left, right) =>
        metricsByAreaKey.get(getAreaKey(right)).totalPackages - metricsByAreaKey.get(getAreaKey(left)).totalPackages,
      budget: (left, right) =>
        metricsByAreaKey.get(getAreaKey(right)).totalBudget - metricsByAreaKey.get(getAreaKey(left)).totalBudget,
    };

    return areas.sort((left, right) => {
      const primary = (sorters[state.sortBy] || sorters.waste)(left, right);
      return primary !== 0 ? primary : left.displayName.localeCompare(right.displayName, "id");
    });
  }

  function getFilteredOwnersForSidebar() {
    let owners = getCentralOwnersForSidebar().slice();

    if (state.search) {
      const query = state.search.toLowerCase();
      owners = owners.filter((owner) => owner.ownerName.toLowerCase().includes(query));
    }

    const sorters = {
      waste: (left, right) => right.totalPotentialWaste - left.totalPotentialWaste,
      priority: (left, right) => right.totalPriorityPackages - left.totalPriorityPackages,
      packages: (left, right) => right.totalPackages - left.totalPackages,
      budget: (left, right) => right.totalBudget - left.totalBudget,
    };

    return owners.sort((left, right) => {
      const primary = (sorters[state.sortBy] || sorters.waste)(left, right);
      return primary !== 0 ? primary : left.ownerName.localeCompare(right.ownerName, "id");
    });
  }

  function renderKpis() {
    const summary = dashboardData.summary;
    const mappedPackages = summary.totalPackages - summary.unmappedPackages;

    renderKpiCards([
      {
        label: "Review Amount",
        value: `$${formatCompactCurrency(summary.totalPotentialWaste)}`,
        sublabel: "Official source amount, de-duplicated for mapped counties",
      },
      {
        label: "Priority Records",
        value: formatNumber(summary.totalPriorityPackages),
        sublabel: `${formatNumber(summary.totalPackages)} reviewed records`,
      },
      {
        label: "Budget Reviewed",
        value: `$${formatCompactCurrency(summary.totalBudget)}`,
        sublabel: "Official amount from source snapshots",
      },
      {
        label: "Mapped Records",
        value: `${formatNumber(mappedPackages)} / ${formatNumber(summary.totalPackages)}`,
        sublabel: `${formatNumber(summary.unmappedPackages)} unmapped | ${formatNumber(summary.multiLocationPackages)} multi-location`,
      },
    ]);
  }

  function renderLegend() {
    const legend = getActiveLegend();
    const title = isProvinceView()
      ? "Review Amount by State"
      : "Review Amount by Jurisdiction";
    const zeroLabel = isProvinceView() ? "No state-level records detected" : "No source amount detected";
    const note = isProvinceView()
      ? "State view shows Nevada source slices; detailed award rows are examples, not additive totals."
      : "County map uses USAspending place-of-performance aggregates; source award rows can overlap with map totals.";
    const rows = [
      `<div class="lt">${escapeHtml(title)}</div>`,
      `<div class="li"><div class="lsw" style="background:${escapeAttr(legend.zeroColor || "#17130a")}"></div> ${escapeHtml(
        zeroLabel
      )}</div>`,
    ];

    (legend.ranges || []).forEach((range) => {
      rows.push(
        `<div class="li"><div class="lsw" style="background:${escapeAttr(range.color)}"></div> $${escapeHtml(
          formatCompactCurrency(range.min)
        )} &ndash; $${escapeHtml(formatCompactCurrency(range.max))}</div>`
      );
    });

    rows.push(`<div class="legend-note">${escapeHtml(note)}</div>`);
    dom.legend.innerHTML = rows.join("");
  }

  function renderFilterChips() {
    dom.mapFilters.innerHTML = FILTERS.map(
      (filter) =>
        `<div class="fc${filter.key === state.mapFilter ? " a" : ""}" onclick="${actionCall("setMapFilter", filter.key)}">${escapeHtml(
          filter.label
        )}</div>`
    ).join("");
  }

  function renderTabs() {
    const provinceView = isProvinceView();
    const centralOwnerMode = isCentralOwnerMode();

    dom.tabs.innerHTML = TABS.map((tab) => {
      const active = provinceView || centralOwnerMode ? tab.key === "all" : tab.key === state.tab;
      const disabled = (provinceView || centralOwnerMode) && tab.key !== "all";

      return `<button class="stb${active ? " a" : ""}"${disabled ? " disabled" : ""} onclick="${actionCall(
        "setTab",
        disabled ? "all" : tab.key
      )}">${escapeHtml(tab.label)}</button>`;
    }).join("");
  }

  function sortControl() {
    const placeholder = isCentralOwnerMode()
      ? "Search federal agency..."
      : isProvinceView()
      ? "Search state..."
      : "Search jurisdiction...";

    return (
      `<div class="sw"><span class="si" aria-hidden="true">/</span><input type="text" placeholder="${escapeAttr(
        placeholder
      )}" value="${escapeAttr(state.search)}" oninput="${actionExpr("dashboardActions.setSearch(this.value)")}" /></div>` +
      `<div class="sort-bar"><label>Sort</label><select onchange="${actionExpr("dashboardActions.setSort(this.value)")}" aria-label="Sort area">` +
      `<option value="waste"${state.sortBy === "waste" ? " selected" : ""}>Review Amount</option>` +
      `<option value="priority"${state.sortBy === "priority" ? " selected" : ""}>Priority Records</option>` +
      `<option value="packages"${state.sortBy === "packages" ? " selected" : ""}>Total Records</option>` +
      `<option value="budget"${state.sortBy === "budget" ? " selected" : ""}>Budget Reviewed</option>` +
      `</select></div>`
    );
  }

  function renderOwnerSidebarContent() {
    const owners = getFilteredOwnersForSidebar();

    if (!owners.length) {
      dom.sidebarContent.innerHTML = sortControl() + `<div class="panel-msg">No federal agency matches this filter.</div>`;
      return;
    }

    const maxWaste = Math.max(...owners.map((owner) => owner.totalPotentialWaste), 1);

    dom.sidebarContent.innerHTML =
      sortControl() +
      owners
        .map((owner, index) => {
          const selectedClass =
            state.selectedOwnerKey === getOwnerCardKey(owner.ownerType, owner.ownerName) ? " a" : "";

          return (
            `<div class="pi${selectedClass}" onclick="${actionCall("openOwnerModal", owner.ownerName, owner.ownerType)}">` +
            `<div class="pit"><div class="pn"><span style="color:var(--t3);font-size:9px;margin-right:5px">#${index + 1}</span>${escapeHtml(
              owner.ownerName
            )}</div><div class="tbd bc">FED</div></div>` +
            `<div style="font-size:9.5px;color:var(--t3);margin-bottom:4px">Federal agency</div>` +
            `<div><span class="ppv">$${escapeHtml(formatCompactCurrency(owner.totalPotentialWaste))}</span><span class="ppl"> &middot; ${escapeHtml(
              formatNumber(owner.totalPriorityPackages)
            )} priority</span></div>` +
            `<div class="bw"><div class="bf" style="width:${Math.max(
              4,
              Math.round((owner.totalPotentialWaste / maxWaste) * 100)
            )}%;background:${escapeAttr(getLegendColor(owner.totalPotentialWaste))}"></div></div>` +
            `<div class="ps"><div class="pst">Total Records: <strong>${escapeHtml(
              formatNumber(owner.totalPackages)
            )}</strong></div><div class="pst">High Volume: <strong>${escapeHtml(
              formatNumber(owner.severityCounts.high)
            )}</strong></div></div>` +
            `<div class="owner-mix">Extreme Volume ${escapeHtml(formatNumber(owner.severityCounts.absurd))}</div>` +
            `<div class="waste-row"><span class="waste-label">Budget Reviewed</span><span class="waste-val">${escapeHtml(
              `$${formatCompactCurrency(owner.totalBudget)}`
            )}</span></div>` +
            `</div>`
          );
        })
        .join("");
  }

  function renderSidebarContent() {
    if (!dashboardData) {
      renderSidebarMessage("Dashboard data is not ready.", true);
      return;
    }

    if (isCentralOwnerMode()) {
      renderOwnerSidebarContent();
      return;
    }

    const areas = getFilteredAreasForSidebar();

    if (!areas.length) {
      dom.sidebarContent.innerHTML =
        sortControl() +
        `<div class="panel-msg">No ${escapeHtml(isProvinceView() ? "state" : "area")} matches this filter.</div>`;
      return;
    }

    const areaEntries = areas.map((area) => ({
      area,
      metrics: getSidebarAreaMetrics(area),
    }));
    const maxWaste = Math.max(...areaEntries.map(({ metrics }) => metrics.totalPotentialWaste), 1);
    const ownerLabel = activeSidebarOwnerLabel();

    dom.sidebarContent.innerHTML =
      sortControl() +
      areaEntries
        .map(({ area, metrics }, index) => {
          const areaKey = getAreaKey(area);
          const selectedClass = state.selectedAreaKey === areaKey ? " a" : "";

          return (
            `<div class="pi${selectedClass}" onclick="${actionCall("openAreaModal", areaKey)}">` +
            `<div class="pit"><div class="pn"><span style="color:var(--t3);font-size:9px;margin-right:5px">#${index + 1}</span>${escapeHtml(
              area.displayName
            )}</div><div class="tbd ${areaBadgeClass(area)}">${escapeHtml(areaBadgeLabel(area))}</div></div>` +
            `<div style="font-size:9.5px;color:var(--t3);margin-bottom:4px">${escapeHtml(areaSecondaryLine(area))}</div>` +
            `<div><span class="ppv">$${escapeHtml(formatCompactCurrency(metrics.totalPotentialWaste))}</span><span class="ppl"> &middot; ${escapeHtml(
              formatNumber(metrics.totalPriorityPackages)
            )} priority</span></div>` +
            `<div class="bw"><div class="bf" style="width:${Math.max(
              4,
              Math.round((metrics.totalPotentialWaste / maxWaste) * 100)
            )}%;background:${escapeAttr(getLegendColor(metrics.totalPotentialWaste))}"></div></div>` +
            `<div class="ps"><div class="pst">Total Records: <strong>${escapeHtml(
              formatNumber(metrics.totalPackages)
            )}</strong></div><div class="pst">Owner: <strong>${escapeHtml(ownerLabel)}</strong></div></div>` +
            `<div class="owner-mix">${escapeHtml(areaOwnerSummary(area))}</div>` +
            `<div class="waste-row"><span class="waste-label">Budget Reviewed</span><span class="waste-val">${escapeHtml(
              `$${formatCompactCurrency(metrics.totalBudget)}`
            )}</span></div>` +
            `</div>`
          );
        })
        .join("");
  }

  function featureStyle(feature) {
    const areaKey = getFeatureAreaKey(feature);
    const area = getActiveAreaByKey(areaKey);
    const visible = areaMatchesCurrentView(area);
    const selected = state.selectedAreaKey === areaKey;
    const regionType = area?.regionType || "";
    const largeBoundary = regionType === "County" || regionType === "State" || regionType === "Provinsi";
    const districtBoundary =
      regionType === "Ward" ||
      regionType === "City" ||
      regionType === "District" ||
      regionType === "School District" ||
      regionType === "Special District" ||
      regionType === "Authority";
    const localLens = state.mapFilter === "kabkota" && !isProvinceView();
    const fillOpacity = selected
      ? 0.72
      : !visible
      ? 0.025
      : largeBoundary && localLens
      ? 0.18
      : largeBoundary
      ? 0.3
      : 0.62;
    const strokeOpacity = selected ? 1 : visible ? (districtBoundary ? 0.9 : 0.62) : 0.16;

    return {
      fillColor: area ? getLegendColor(area.totalPotentialWaste) : "#17130a",
      fillOpacity,
      strokeColor: selected ? "#f6d66b" : districtBoundary ? "#d4af37" : "#8f7b3d",
      strokeWidth: selected ? 2.6 : districtBoundary ? 1.55 : 1,
      strokeOpacity,
      sortKey: selected ? 100 : districtBoundary ? 60 : largeBoundary ? 10 : 30,
      interactive: Boolean(visible || selected),
      labelText: visible ? area?.displayName || "" : "",
      labelKind: districtBoundary ? "district" : largeBoundary ? "boundary" : "area",
      labelPriority: selected ? 9 : districtBoundary ? 6 : largeBoundary ? 1 : 3,
    };
  }

  function popupHtml(area) {
    if (!area) {
      return `<div class="pt">No data yet</div>`;
    }

    if (isProvinceView()) {
      return (
        `<div class="pt">${escapeHtml(area.displayName)}</div>` +
        `<div class="popup-sub">State-level records</div>` +
        `<div class="pr"><span class="l">Review Amount</span><span class="v" style="color:#d4af37">$${escapeHtml(
          formatCompactCurrency(area.totalPotentialWaste)
        )}</span></div>` +
        `<div class="pr"><span class="l">Priority Records</span><span class="v">${escapeHtml(
          formatNumber(area.totalPriorityPackages)
        )}</span></div>` +
        `<div class="pr"><span class="l">Total Records</span><span class="v">${escapeHtml(
          formatNumber(area.totalPackages)
        )}</span></div>` +
        `<div class="pr"><span class="l">Budget Reviewed</span><span class="v">$${escapeHtml(
          formatCompactCurrency(area.totalBudget)
        )}</span></div>` +
        `<div class="pr"><span class="l">High Volume</span><span class="v">${escapeHtml(
          formatNumber(area.severityCounts.high)
        )}</span></div>` +
        `<div class="ppb"><div class="ppbf" style="width:${Math.min(
          100,
          area.totalPriorityPackages > 0 ? Math.round((area.totalPriorityPackages / Math.max(area.totalPackages, 1)) * 100) : 0
        )}%;background:${escapeAttr(getLegendColor(area.totalPotentialWaste))}"></div></div>`
      );
    }

    return (
      `<div class="pt">${escapeHtml(area.displayName)}</div>` +
      `<div class="popup-sub">${escapeHtml(area.provinceName)}</div>` +
      `<div class="pr"><span class="l">Review Amount</span><span class="v" style="color:#d4af37">$${escapeHtml(
        formatCompactCurrency(area.totalPotentialWaste)
      )}</span></div>` +
      `<div class="pr"><span class="l">Priority Records</span><span class="v">${escapeHtml(
        formatNumber(area.totalPriorityPackages)
      )}</span></div>` +
      `<div class="pr"><span class="l">Total Records</span><span class="v">${escapeHtml(
        formatNumber(area.totalPackages)
      )}</span></div>` +
      `<div class="pr"><span class="l">Federal</span><span class="v">${escapeHtml(
        formatNumber(ownerTypeCount(area, "central"))
      )}</span></div>` +
      `<div class="pr"><span class="l">State</span><span class="v">${escapeHtml(
        formatNumber(ownerTypeCount(area, "provinsi"))
      )}</span></div>` +
      `<div class="pr"><span class="l">Local</span><span class="v">${escapeHtml(
        formatNumber(ownerTypeCount(area, "kabkota"))
      )}</span></div>` +
      `<div class="pr"><span class="l">Others</span><span class="v">${escapeHtml(
        formatNumber(ownerTypeCount(area, "other"))
      )}</span></div>` +
      `<div class="ppb"><div class="ppbf" style="width:${Math.min(
        100,
        area.totalPriorityPackages > 0 ? Math.round((area.totalPriorityPackages / Math.max(area.totalPackages, 1)) * 100) : 0
      )}%;background:${escapeAttr(getLegendColor(area.totalPotentialWaste))}"></div></div>`
    );
  }

  function renderGeoLayer(fitToBounds) {
    const geo = getActiveGeo();

    if (!geo || !Array.isArray(geo.features) || !geo.features.length) {
      setMapStatus("No geometry for this map mode.", true);
      return;
    }

    AuditMap.render(
      dom.mapRoot,
      geo,
      {
        getFeatureStyle: featureStyle,
        getPopupHtml: (areaKey) => popupHtml(getActiveAreaByKey(areaKey)),
        onAreaClick: openAreaModal,
        fitBounds: fitToBounds,
        isProvinceView: isProvinceView(),
      },
      clearMapStatus
    );
  }

  function initMap() {
    renderGeoLayer(true);
  }

  function refreshMapStyles() {
    AuditMap.refresh(getActiveGeo(), featureStyle);
  }

  function renderPackageTableRows(items) {
    return items.length
      ? items
          .map((item) => {
            const packageUrl = buildSourceUrl(item.sourceId);

            return (
              `<tr${
                packageUrl
                  ? ` class="package-row-link" tabindex="0" role="link" aria-label="${escapeAttr(
                      `Open source record for ${item.packageName}`
                    )}" onclick="${actionCall("openPackageDetail", item.sourceId)}" onkeydown="${actionExpr(
                      `dashboardActions.handlePackageRowKeydown(event, ${jsArg(item.sourceId)})`
                    )}"`
                  : ""
              }>` +
              `<td class="mono">${escapeHtml(String(item.sourceId || item.id))}</td>` +
              `<td class="pkg">${escapeHtml(item.packageName)}</td>` +
              `<td><div class="tbl-owner">${escapeHtml(item.ownerName)}</div><div class="tbl-sub">${escapeHtml(
                ownerTypeLabel(item.ownerType)
              )}</div></td>` +
              `<td><div class="tbl-owner">${escapeHtml(item.satker || "-")}</div><div class="tbl-sub">${escapeHtml(
                item.locationRaw || "-"
              )}</div></td>` +
              `<td class="mono" style="color:var(--sage)">${escapeHtml(item.budget === null ? "-" : formatCurrencyLong(item.budget))}</td>` +
              `<td><span class="sev-b" style="background:${escapeAttr(
                item.audit.severity === "absurd"
                  ? "rgba(212,169,153,.18)"
                  : item.audit.severity === "high"
                  ? "rgba(168,60,46,.16)"
                  : item.audit.severity === "med"
                    ? "rgba(139,115,50,.16)"
                    : "rgba(123,134,163,.16)"
              )};color:${escapeAttr(severityColor(item.audit.severity))}">${escapeHtml(
                severityLabel(item.audit.severity)
              )}</span></td>` +
              `<td class="reason">${escapeHtml(item.audit.reason || "-")}</td>` +
              `</tr>`
            );
          })
          .join("")
      : `<tr><td colspan="7" class="table-empty">No records for the current filter.</td></tr>`;
  }

  function renderPagination(pagination) {
    return (
      `<div class="pager"><button class="pager-btn" ${pagination.page <= 1 ? "disabled" : ""} onclick="${actionCall(
        "changeModalPage",
        pagination.page - 1
      )}">Previous</button><div class="pager-text">Page ${escapeHtml(formatNumber(pagination.page))} / ${escapeHtml(
        formatNumber(pagination.totalPages)
      )} &middot; ${escapeHtml(formatNumber(pagination.totalItems))} records</div><button class="pager-btn" ${
        pagination.page >= pagination.totalPages ? "disabled" : ""
      } onclick="${actionCall("changeModalPage", pagination.page + 1)}">Next</button></div>`
    );
  }

  function renderRegionModalContent(payload) {
    const region = payload.region;
    const rowsHtml = renderPackageTableRows(payload.items);

    dom.modalTop.innerHTML =
      `<div class="modal-top-row"><div><h2>${escapeHtml(region.displayName)}</h2><div class="msub">${escapeHtml(
        `${region.provinceName} | Public spending review FY 2026`
      )}</div></div>` +
      `<div style="display:flex;gap:8px;align-items:center"><span class="tbd ${areaBadgeClass(region)}">${escapeHtml(
        region.regionType
      )}</span><button class="modal-close" onclick="${actionCall(
        "closeRegionModal"
      )}">&#10005; Close</button></div></div>` +
      `<div class="modal-kpis">` +
      `<div class="mkp"><div class="mkp-l">Review Amount</div><div class="mkp-v" style="color:var(--brick)">$${escapeHtml(
        formatCompactCurrency(region.totalPotentialWaste)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">Priority Records</div><div class="mkp-v">${escapeHtml(
        formatNumber(region.totalPriorityPackages)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">Total Records</div><div class="mkp-v">${escapeHtml(
        formatNumber(region.totalPackages)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">Budget Reviewed</div><div class="mkp-v" style="color:var(--sage)">$${escapeHtml(
        formatCompactCurrency(region.totalBudget)
      )}</div></div></div>`;

    dom.modalBody.innerHTML =
      `<div class="modal-summary-grid">` +
      `<div class="mini-stat"><span>Federal</span><strong>${escapeHtml(
        formatNumber(ownerTypeCount(region, "central"))
      )}</strong></div>` +
      `<div class="mini-stat"><span>State</span><strong>${escapeHtml(
        formatNumber(ownerTypeCount(region, "provinsi"))
      )}</strong></div>` +
      `<div class="mini-stat"><span>Local</span><strong>${escapeHtml(
        formatNumber(ownerTypeCount(region, "kabkota"))
      )}</strong></div>` +
      `<div class="mini-stat"><span>Others</span><strong>${escapeHtml(
        formatNumber(ownerTypeCount(region, "other"))
      )}</strong></div>` +
      `<div class="mini-stat"><span>High Volume</span><strong>${escapeHtml(formatNumber(region.severityCounts.high))}</strong></div>` +
      `<div class="mini-stat"><span>Extreme Volume</span><strong>${escapeHtml(
        formatNumber(region.severityCounts.absurd)
      )}</strong></div>` +
      `</div>` +
      `<div class="modal-filters">` +
      `<input type="text" placeholder="Search record, owner, or office..." value="${escapeAttr(
        state.modal.search
      )}" oninput="${actionExpr("dashboardActions.setModalSearch(this.value)")}" />` +
      `<select onchange="${actionExpr("dashboardActions.setModalOwnerType(this.value)")}" aria-label="Filter owner type">` +
      `<option value="">All Owners</option><option value="central"${state.modal.ownerType === "central" ? " selected" : ""}>Federal</option>` +
      `<option value="provinsi"${state.modal.ownerType === "provinsi" ? " selected" : ""}>State</option><option value="kabkota"${
        state.modal.ownerType === "kabkota" ? " selected" : ""
      }>Local / District</option><option value="other"${
        state.modal.ownerType === "other" ? " selected" : ""
      }>Others</option></select>` +
      `<select onchange="${actionExpr("dashboardActions.setModalSeverity(this.value)")}" aria-label="Filter review tier">${renderSeverityFilterOptions(
        state.modal.severity
      )}</select>` +
      `<label class="chk"><input type="checkbox" ${state.modal.priorityOnly ? "checked" : ""} onchange="${actionExpr(
        "dashboardActions.setModalPriorityOnly(this.checked)"
      )}" /> Priority only</label>` +
      `</div>` +
      `<div class="modal-cnt">Showing ${escapeHtml(formatNumber(payload.items.length))} of ${escapeHtml(
        formatNumber(payload.pagination.totalItems)
      )} records in this area</div>` +
      `<div class="rtbl-wrap"><table class="rtbl"><thead><tr><th>ID</th><th>Record</th><th>Owner</th><th>Office / Location</th><th>Amount</th><th>Tier</th><th>Reason</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` +
      renderPagination(payload.pagination);
  }

  function renderProvinceModalContent(payload) {
    const province = payload.province;
    const rowsHtml = renderPackageTableRows(payload.items);

    dom.modalTop.innerHTML =
      `<div class="modal-top-row"><div><h2>${escapeHtml(province.displayName)}</h2><div class="msub">State-level records &middot; FY 2026</div></div>` +
      `<div style="display:flex;gap:8px;align-items:center"><span class="tbd ${areaBadgeClass(province)}">State</span><button class="modal-close" onclick="${actionCall(
        "closeRegionModal"
      )}">&#10005; Close</button></div></div>` +
      `<div class="modal-kpis">` +
      `<div class="mkp"><div class="mkp-l">Review Amount</div><div class="mkp-v" style="color:var(--brick)">$${escapeHtml(
        formatCompactCurrency(province.totalPotentialWaste)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">Priority Records</div><div class="mkp-v">${escapeHtml(
        formatNumber(province.totalPriorityPackages)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">State Records</div><div class="mkp-v">${escapeHtml(
        formatNumber(province.totalPackages)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">Budget Reviewed</div><div class="mkp-v" style="color:var(--sage)">$${escapeHtml(
        formatCompactCurrency(province.totalBudget)
      )}</div></div></div>`;

    dom.modalBody.innerHTML =
      `<div class="modal-summary-grid">` +
      `<div class="mini-stat"><span>Flagged Records</span><strong>${escapeHtml(
        formatNumber(province.totalFlaggedPackages)
      )}</strong></div>` +
      `<div class="mini-stat"><span>Medium Volume</span><strong>${escapeHtml(
        formatNumber(province.severityCounts.med)
      )}</strong></div>` +
      `<div class="mini-stat"><span>High Volume</span><strong>${escapeHtml(
        formatNumber(province.severityCounts.high)
      )}</strong></div>` +
      `<div class="mini-stat"><span>Extreme Volume</span><strong>${escapeHtml(
        formatNumber(province.severityCounts.absurd)
      )}</strong></div>` +
      `<div class="mini-stat"><span>Avg Risk Score</span><strong>${escapeHtml(
        formatDecimal(province.avgRiskScore)
      )}</strong></div>` +
      `<div class="mini-stat"><span>Max Risk Score</span><strong>${escapeHtml(
        formatNumber(province.maxRiskScore)
      )}</strong></div>` +
      `</div>` +
      (province.coverageNote ? `<div class="coverage-note"><span class="coverage-note-icon">ⓘ</span> <strong>Data coverage:</strong> ${escapeHtml(province.coverageNote)}</div>` : "") +
      `<div class="modal-filters">` +
      `<input type="text" placeholder="Search record, owner, or office..." value="${escapeAttr(
        state.modal.search
      )}" oninput="${actionExpr("dashboardActions.setModalSearch(this.value)")}" />` +
      `<select onchange="${actionExpr("dashboardActions.setModalSeverity(this.value)")}" aria-label="Filter review tier">${renderSeverityFilterOptions(
        state.modal.severity
      )}</select>` +
      `<label class="chk"><input type="checkbox" ${state.modal.priorityOnly ? "checked" : ""} onchange="${actionExpr(
        "dashboardActions.setModalPriorityOnly(this.checked)"
      )}" /> Priority only</label>` +
      `</div>` +
      `<div class="modal-cnt">Showing ${escapeHtml(formatNumber(payload.items.length))} of ${escapeHtml(
        formatNumber(payload.pagination.totalItems)
      )} state-level records</div>` +
      `<div class="rtbl-wrap"><table class="rtbl"><thead><tr><th>ID</th><th>Record</th><th>Owner</th><th>Office / Location</th><th>Amount</th><th>Tier</th><th>Reason</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` +
      renderPagination(payload.pagination);
  }

  function renderOwnerModalContent(payload) {
    const owner = payload.owner;
    const rowsHtml = renderPackageTableRows(payload.items);

    dom.modalTop.innerHTML =
      `<div class="modal-top-row"><div><h2>${escapeHtml(owner.ownerName)}</h2><div class="msub">${escapeHtml(
        `${ownerTypeLabel(owner.ownerType)} | National public spending review FY 2026`
      )}</div></div>` +
      `<div style="display:flex;gap:8px;align-items:center"><span class="tbd bc">FED</span><button class="modal-close" onclick="${actionCall(
        "closeRegionModal"
      )}">&#10005; Close</button></div></div>` +
      `<div class="modal-kpis">` +
      `<div class="mkp"><div class="mkp-l">Review Amount</div><div class="mkp-v" style="color:var(--brick)">$${escapeHtml(
        formatCompactCurrency(owner.totalPotentialWaste)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">Priority Records</div><div class="mkp-v">${escapeHtml(
        formatNumber(owner.totalPriorityPackages)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">Total Records</div><div class="mkp-v">${escapeHtml(
        formatNumber(owner.totalPackages)
      )}</div></div>` +
      `<div class="mkp"><div class="mkp-l">Budget Reviewed</div><div class="mkp-v" style="color:var(--sage)">$${escapeHtml(
        formatCompactCurrency(owner.totalBudget)
      )}</div></div></div>`;

    dom.modalBody.innerHTML =
      `<div class="modal-summary-grid">` +
      `<div class="mini-stat"><span>Flagged Records</span><strong>${escapeHtml(
        formatNumber(owner.totalFlaggedPackages)
      )}</strong></div>` +
      `<div class="mini-stat"><span>Medium Volume</span><strong>${escapeHtml(
        formatNumber(owner.severityCounts.med)
      )}</strong></div>` +
      `<div class="mini-stat"><span>High Volume</span><strong>${escapeHtml(
        formatNumber(owner.severityCounts.high)
      )}</strong></div>` +
      `<div class="mini-stat"><span>Extreme Volume</span><strong>${escapeHtml(
        formatNumber(owner.severityCounts.absurd)
      )}</strong></div>` +
      `</div>` +
      `<div class="modal-filters">` +
      `<input type="text" placeholder="Search record or office..." value="${escapeAttr(
        state.modal.search
      )}" oninput="${actionExpr("dashboardActions.setModalSearch(this.value)")}" />` +
      `<select onchange="${actionExpr("dashboardActions.setModalSeverity(this.value)")}" aria-label="Filter review tier">${renderSeverityFilterOptions(
        state.modal.severity
      )}</select>` +
      `<label class="chk"><input type="checkbox" ${state.modal.priorityOnly ? "checked" : ""} onchange="${actionExpr(
        "dashboardActions.setModalPriorityOnly(this.checked)"
      )}" /> Priority only</label>` +
      `</div>` +
      `<div class="modal-cnt">Showing ${escapeHtml(formatNumber(payload.items.length))} of ${escapeHtml(
        formatNumber(payload.pagination.totalItems)
      )} records for this owner</div>` +
      `<div class="rtbl-wrap"><table class="rtbl"><thead><tr><th>ID</th><th>Record</th><th>Owner</th><th>Office / Location</th><th>Amount</th><th>Tier</th><th>Reason</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` +
      renderPagination(payload.pagination);
  }

  function renderModalContent(payload) {
    if (state.modal.areaType === "owner") {
      renderOwnerModalContent(payload);
      return;
    }

    if (state.modal.areaType === "province") {
      renderProvinceModalContent(payload);
      return;
    }

    renderRegionModalContent(payload);
  }

  function normalizeStaticPackage(item) {
    return {
      ...item,
      audit: {
        severity: item.audit?.severity || "low",
        reason: item.audit?.reason || "",
        schemaVersion: item.audit?.schemaVersion || "static_demo",
        potensiPemborosan: Number(item.audit?.potensiPemborosan || item.potentialWaste || 0),
        flags: item.audit?.flags || {},
      },
      meta: {
        isPriority: Boolean(item.meta?.isPriority),
        isFlagged: Boolean(item.meta?.isFlagged),
        riskScore: Number(item.meta?.riskScore || 0),
        activeTagCount: Number(item.meta?.activeTagCount || 0),
        mappedRegionCount: Number(item.meta?.mappedRegionCount || 0),
      },
    };
  }

  function staticPackageMatchesScope(item) {
    if (state.modal.areaType === "owner") {
      return item.ownerType === state.modal.ownerType && item.ownerName === state.modal.ownerName;
    }

    if (state.modal.areaType === "province") {
      return Array.isArray(item.provinceKeys) && item.provinceKeys.includes(state.modal.areaKey);
    }

    return Array.isArray(item.regionKeys) && item.regionKeys.includes(state.modal.areaKey);
  }

  function staticPackageMatchesFilters(item) {
    if (state.modal.search) {
      const query = state.modal.search.toLowerCase();
      const text = [item.packageName, item.ownerName, item.satker, item.locationRaw].join(" ").toLowerCase();
      if (!text.includes(query)) {
        return false;
      }
    }

    if (state.modal.areaType === "region" && state.modal.ownerType && item.ownerType !== state.modal.ownerType) {
      return false;
    }

    if (state.modal.severity && item.audit?.severity !== state.modal.severity) {
      return false;
    }

    if (state.modal.priorityOnly && !item.meta?.isPriority) {
      return false;
    }

    return true;
  }

  function sortStaticPackages(left, right) {
    const leftWaste = Number(left.audit?.potensiPemborosan || 0);
    const rightWaste = Number(right.audit?.potensiPemborosan || 0);
    return (
      Number(right.meta?.isPriority || 0) - Number(left.meta?.isPriority || 0) ||
      rightWaste - leftWaste ||
      Number(right.meta?.riskScore || 0) - Number(left.meta?.riskScore || 0) ||
      Number(right.budget || 0) - Number(left.budget || 0)
    );
  }

  function buildStaticPackagePage() {
    const rows = (dashboardData.packageSamples || [])
      .map(normalizeStaticPackage)
      .filter(staticPackageMatchesScope)
      .filter(staticPackageMatchesFilters)
      .sort(sortStaticPackages);
    const totalItems = rows.length;
    const pageSize = state.modal.pageSize;
    const totalPages = totalItems ? Math.ceil(totalItems / pageSize) : 1;
    const page = Math.min(Math.max(state.modal.page, 1), totalPages);
    const offset = (page - 1) * pageSize;
    const items = rows.slice(offset, offset + pageSize);

    return {
      summary: {
        totalItems,
        filteredItems: totalItems,
      },
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
      filters: {
        search: state.modal.search,
        ownerType: state.modal.ownerType,
        severity: state.modal.severity,
        priorityOnly: state.modal.priorityOnly,
      },
      items,
    };
  }

  function getStaticPackagePayload() {
    const page = buildStaticPackagePage();

    if (state.modal.areaType === "owner") {
      const owner = getCentralOwnersForSidebar().find(
        (item) => item.ownerType === state.modal.ownerType && item.ownerName === state.modal.ownerName
      );
      return owner ? { ...page, owner } : null;
    }

    if (state.modal.areaType === "province") {
      const province = provincesByKey.get(state.modal.areaKey);
      return province ? { ...page, province } : null;
    }

    const region = regionsByKey.get(state.modal.areaKey);
    return region ? { ...page, region } : null;
  }

  async function loadAreaPackages() {
    if (
      (state.modal.areaType === "owner" && (!state.modal.ownerType || !state.modal.ownerName)) ||
      (state.modal.areaType !== "owner" && !state.modal.areaKey)
    ) {
      return;
    }

    state.modalRequestId += 1;
    const requestId = state.modalRequestId;
    renderModalState(
      state.modal.areaType === "owner" ? "Loading owner..." : "Loading area...",
      state.modal.areaType === "owner"
        ? "Reading selected owner records..."
        : "Reading public spending records...",
      false
    );

    if (STATIC_DATA_BASE_URL) {
      const payload = getStaticPackagePayload();
      if (requestId !== state.modalRequestId) {
        return;
      }
      if (!payload) {
        renderModalState("No static records", "No generated package artifact exists for this selection.", true);
        return;
      }
      renderModalContent(payload);
      return;
    }

    const params = new URLSearchParams({
      page: String(state.modal.page),
      pageSize: String(state.modal.pageSize),
    });

    if (state.modal.search) {
      params.set("search", state.modal.search);
    }

    if (state.modal.areaType === "region" && state.modal.ownerType) {
      params.set("ownerType", state.modal.ownerType);
    }

    if (state.modal.severity) {
      params.set("severity", state.modal.severity);
    }

    if (state.modal.priorityOnly) {
      params.set("priorityOnly", "true");
    }

    const path =
      state.modal.areaType === "owner"
        ? (() => {
            params.set("ownerType", state.modal.ownerType);
            params.set("ownerName", state.modal.ownerName);
            return `/owners/packages?${params.toString()}`;
          })()
        : state.modal.areaType === "province"
        ? `/provinces/${encodeURIComponent(state.modal.areaKey)}/packages?${params.toString()}`
        : `/regions/${encodeURIComponent(state.modal.areaKey)}/packages?${params.toString()}`;

    try {
      const payload = await fetchJson(path);

      if (requestId !== state.modalRequestId) {
        return;
      }

      renderModalContent(payload);
    } catch (error) {
      if (requestId !== state.modalRequestId) {
        return;
      }

      renderModalState("Failed to load records", formatFetchError(error), true);
    }
  }

  function openAreaModal(areaKey) {
    AuditMap.closePopup();
    state.selectedAreaKey = areaKey;
    state.selectedOwnerKey = null;
    state.modal = {
      areaType: currentAreaType(),
      areaKey,
      ownerName: "",
      page: 1,
      pageSize: 25,
      search: "",
      ownerType: "",
      severity: "",
      priorityOnly: false,
    };

    refreshMapStyles();
    renderSidebarContent();
    dom.modal.classList.add("open");
    document.body.style.overflow = "hidden";
    loadAreaPackages();
  }

  function openOwnerModal(ownerName, ownerType) {
    AuditMap.closePopup();
    state.selectedAreaKey = null;
    state.selectedOwnerKey = getOwnerCardKey(ownerType, ownerName);
    state.modal = {
      areaType: "owner",
      areaKey: null,
      ownerName,
      page: 1,
      pageSize: 25,
      search: "",
      ownerType,
      severity: "",
      priorityOnly: false,
    };

    refreshMapStyles();
    renderSidebarContent();
    dom.modal.classList.add("open");
    document.body.style.overflow = "hidden";
    loadAreaPackages();
  }

  function closeRegionModal() {
    state.modalRequestId += 1;
    state.modal = {
      areaType: currentAreaType(),
      areaKey: null,
      ownerName: "",
      page: 1,
      pageSize: 25,
      search: "",
      ownerType: "",
      severity: "",
      priorityOnly: false,
    };
    dom.modal.classList.remove("open");
    document.body.style.overflow = "";
  }

  function setSearch(value) {
    state.search = value;
    renderSidebarContent();
  }

  function setSort(value) {
    state.sortBy = value;
    renderSidebarContent();
  }

  function setTab(value) {
    if (isProvinceView() || isCentralOwnerMode()) {
      state.tab = "all";
      renderTabs();
      return;
    }

    state.tab = value;
    refreshMapStyles();
    renderTabs();
    renderSidebarContent();
  }

  function setMapFilter(value) {
    const wasProvinceView = isProvinceView();
    const wasCentralOwnerMode = isCentralOwnerMode();
    state.mapFilter = value;
    const viewChanged = wasProvinceView !== isProvinceView();
    const centralOwnerModeChanged = wasCentralOwnerMode !== isCentralOwnerMode();

    if (viewChanged) {
      state.tab = "all";
      state.selectedAreaKey = null;
      state.selectedOwnerKey = null;
      closeRegionModal();
      renderLegend();
      renderFilterChips();
      renderTabs();
      renderSidebarContent();
      renderGeoLayer(true);
      return;
    }

    if (centralOwnerModeChanged) {
      state.tab = "all";
      state.selectedAreaKey = null;
      state.selectedOwnerKey = null;

      if (state.modal.areaType === "owner" && !isCentralOwnerMode()) {
        closeRegionModal();
      }
    }

    refreshMapStyles();
    renderFilterChips();
    renderTabs();
    renderSidebarContent();
  }

  function setModalSearch(value) {
    state.modal.search = value;
    state.modal.page = 1;
    loadAreaPackages();
  }

  function setModalOwnerType(value) {
    if (state.modal.areaType === "province" || state.modal.areaType === "owner") {
      return;
    }

    state.modal.ownerType = value;
    state.modal.page = 1;
    loadAreaPackages();
  }

  function setModalSeverity(value) {
    state.modal.severity = value;
    state.modal.page = 1;
    loadAreaPackages();
  }

  function setModalPriorityOnly(value) {
    state.modal.priorityOnly = Boolean(value);
    state.modal.page = 1;
    loadAreaPackages();
  }

  function changeModalPage(page) {
    state.modal.page = page;
    loadAreaPackages();
  }

  function openPackageDetail(sourceId) {
    const url = buildSourceUrl(sourceId);
    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handlePackageRowKeydown(event, sourceId) {
    if (!event) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") {
      return;
    }

    event.preventDefault();
    openPackageDetail(sourceId);
  }

  function showHowItWorks() {
    const modal = document.getElementById("hiwModal");
    if (modal) { modal.classList.add("open"); document.body.style.overflow = "hidden"; }
  }

  function closeHowItWorks() {
    const modal = document.getElementById("hiwModal");
    if (modal) { modal.classList.remove("open"); document.body.style.overflow = ""; }
  }

  function closeKpis() {
    document.getElementById("kpi")?.classList.remove("open");
    document.getElementById("kpiBackdrop")?.classList.remove("open");
  }

  function toggleKpis() {
    const panel = document.getElementById("kpi");
    const backdrop = document.getElementById("kpiBackdrop");
    if (!panel || !backdrop) return;
    const willOpen = !panel.classList.contains("open");
    if (willOpen) closeFeedback();
    panel.classList.toggle("open", willOpen);
    backdrop.classList.toggle("open", willOpen);
  }

  function toggleLegend() {
    document.getElementById("legend-container")?.classList.toggle("open");
  }

  function toggleSidebar() {
    closeFeedback();
    closeKpis();
    document.getElementById("sidebar")?.classList.toggle("expanded");
  }

  function loadTurnstile() {
    if (!window.TURNSTILE_SITE_KEY) return Promise.resolve(null);
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoadPromise) return turnstileLoadPromise;

    turnstileLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.turnstile || null);
      script.onerror = () => reject(new Error("Turnstile failed to load"));
      document.head.appendChild(script);
    }).catch(() => null);

    return turnstileLoadPromise;
  }

  async function renderTurnstile(container, siteKey) {
    const turnstile = await loadTurnstile();
    if (!turnstile || !container || !siteKey || !document.body.contains(container)) return;
    container.innerHTML = "";
    window._turnstileToken = null;
    turnstile.render(container, {
      sitekey: siteKey,
      theme: "dark",
      callback: (token) => { window._turnstileToken = token; },
      "expired-callback": () => { window._turnstileToken = null; },
    });
  }

  function openFeedback() {
    const panel = document.getElementById("feedbackPanel");
    if (!panel) return;
    closeKpis();
    document.getElementById("sidebar")?.classList.remove("expanded");
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    const text = document.getElementById("feedbackText");
    if (text) text.focus();

    const siteKey = window.TURNSTILE_SITE_KEY;
    const container = document.getElementById("turnstileContainer");
    if (siteKey && container) {
      renderTurnstile(container, siteKey);
    }
  }

  function closeFeedback() {
    const panel = document.getElementById("feedbackPanel");
    if (!panel) return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    window._turnstileToken = null;
  }

  function submitFeedback() {
    const siteKey = window.TURNSTILE_SITE_KEY;
    if (siteKey && !window._turnstileToken) {
      alert("Please complete the security check before submitting.");
      return;
    }

    const type = document.getElementById("feedbackType")?.value || "General comment";
    const note = document.getElementById("feedbackText")?.value.trim() || "(no note entered)";
    const sourceMode = dashboardData?.sourceMeta?.mode || "unknown";
    const title = `[${type}] USA Spending Watch feedback`;
    const body = [
      `Type: ${type}`,
      `URL: ${window.location.href}`,
      `Data mode: ${sourceMode}`,
      `Map filter: ${state.mapFilter}`,
      `Tab: ${state.tab}`,
      "",
      "Feedback:",
      note,
    ].join("\n");
    const url =
      "https://github.com/iamthetonyb/USAspend/issues/new?" +
      new URLSearchParams({ title, body }).toString();
    window._turnstileToken = null;
    window.open(url, "_blank", "noopener,noreferrer");
    closeFeedback();
  }

  function countUp(el, target, prefix, suffix, duration) {
    if (!el) return;
    const start = performance.now();
    const isFloat = target % 1 !== 0;
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const val = target * ease;
      el.textContent = prefix + (isFloat ? val.toFixed(1) : Math.round(val).toLocaleString("en-US")) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = prefix + (isFloat ? target.toFixed(1) : target.toLocaleString("en-US")) + suffix;
    };
    requestAnimationFrame(step);
  }

  function initHeroStats() {
    if (!dashboardData) return;
    const s = dashboardData.summary;
    const budget = (Number(s.totalBudget) || 0) / 1e9;
    const priority = Number(s.totalPriorityPackages) || 0;
    const jurisdictions = Number(dashboardData.regions?.length) || 0;
    setTimeout(() => {
      countUp(document.getElementById("hv-budget"), budget, "$", "B", 1800);
      countUp(document.getElementById("hv-priority"), priority, "", "", 1800);
      countUp(document.getElementById("hv-jurisdictions"), jurisdictions, "", "", 1600);
    }, 180);
  }

  function initMapResizeObserver() {
    const appSection = document.getElementById("app");
    if (!appSection || !window.IntersectionObserver) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) AuditMap.resize();
    }, { threshold: 0.1 });
    io.observe(appSection);
  }

  function bindEvents() {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeKpis();
        closeFeedback();
        closeRegionModal();
        closeHowItWorks();
      }
    });

    dom.modal.addEventListener("click", (event) => {
      if (event.target === dom.modal) {
        closeRegionModal();
      }
    });

    initMapResizeObserver();
  }

  async function bootstrap() {
    renderBootstrapLoading();

    try {
      dashboardData = normalizeDashboardData(
        STATIC_DATA_BASE_URL ? await fetchStaticJson("bootstrap.json") : await fetchJson("/bootstrap")
      );
      regionsByKey = new Map(dashboardData.regions.map((region) => [region.regionKey, region]));
      provincesByKey = new Map(dashboardData.provinceView.provinces.map((province) => [province.provinceKey, province]));
      const generatedAt = dashboardData?.sourceMeta?.generatedAt;
      if (generatedAt) {
        const el = document.querySelector(".ll");
        if (el) {
          const d = new Date(generatedAt);
          const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          el.title = `Data generated ${label}`;
        }
      }
      renderKpis();
      initHeroStats();
      renderLegend();
      initMap();
      renderFilterChips();
      renderTabs();
      renderSidebarContent();
    } catch (error) {
      renderBootstrapError(formatFetchError(error));
    }
  }

  window.dashboardActions = {
    changeModalPage,
    closeFeedback,
    closeHowItWorks,
    closeKpis,
    closeRegionModal,
    handlePackageRowKeydown,
    openFeedback,
    openAreaModal,
    openOwnerModal,
    openPackageDetail,
    setMapFilter,
    setModalOwnerType,
    setModalPriorityOnly,
    setModalSearch,
    setModalSeverity,
    setSearch,
    setSort,
    setTab,
    showHowItWorks,
    submitFeedback,
    toggleKpis,
    toggleLegend,
    toggleSidebar,
  };

  bindEvents();
  bootstrap();
})();
