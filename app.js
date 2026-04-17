const DATASETS = {
  "competition_results.csv": {
    label: "Competition Result 1",
    descriptor:
      "Run 1: max tokens used were 10000 for each model. Processing stopped early because credits ran out after 43 rows.",
  },
  "competition_results2.csv": {
    label: "Competition Result 2",
    descriptor:
      "Run 2: max tokens used were 4000 for each model, and all 143 rows were processed.",
  },
};

const MODEL_CONFIG = {
  gpt: {
    nameKey: "deceased_name_gpt5",
    ocrKey: "ocr_passage_gpt5",
    modernKey: "modernized_text_gpt5",
  },
  claude: {
    nameKey: "deceased_name_claude_sonnet_4_6",
    ocrKey: "ocr_passage_claude_sonnet_4_6",
    modernKey: "modernized_text_claude_sonnet_4_6",
  },
  deepseek: {
    nameKey: "deceased_name_deepseek_r1",
    ocrKey: "ocr_passage_deepseek_r1",
    modernKey: "modernized_text_deepseek_r1",
  },
};

function getDatasetMeta(datasetName) {
  return DATASETS[datasetName] || {
    label: datasetName,
    descriptor: "",
  };
}

function isMeaningful(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  return s !== "" && s.toUpperCase() !== "NA";
}

function cleanName(value) {
  return String(value || "")
    .replace(/\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normName(value) {
  return cleanName(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageKey(row) {
  return [
    row.name || "",
    row.newspaper_url || "",
    row.date_of_publication || "",
    row.page_year || ""
  ].join("||");
}

function deriveTitle(row) {
  if (isMeaningful(row.newspaper_title)) return row.newspaper_title;
  return "NA";
}

function deriveCelebName(row) {
  if (isMeaningful(row.name)) return row.name;
  return "NA";
}

function countModelObits(rows, modelKey) {
  const cfg = MODEL_CONFIG[modelKey];
  return rows.filter(r => isMeaningful(r[cfg.nameKey])).length;
}

function groupRowsByPage(rows) {
  const grouped = new Map();
  rows.forEach(row => {
    const key = pageKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  return grouped;
}

function buildSummaryRows(rows, datasetName) {
  const grouped = groupRowsByPage(rows);
  const summary = [];

  for (const [key, pageRows] of grouped.entries()) {
    const first = pageRows[0];
    summary.push({
      id: encodeURIComponent(key),
      dataset: datasetName,
      title: deriveTitle(first),
      celebName: deriveCelebName(first),
      year: first.page_year || "",
      date: first.date_of_publication || "",
      url: first.newspaper_url || "",
      gptCount: countModelObits(pageRows, "gpt"),
      claudeCount: countModelObits(pageRows, "claude"),
      deepseekCount: countModelObits(pageRows, "deepseek"),
    });
  }

  summary.sort((a, b) =>
    String(a.year).localeCompare(String(b.year)) ||
    String(a.date).localeCompare(String(b.date)) ||
    String(a.title).localeCompare(String(b.title)) ||
    String(a.celebName).localeCompare(String(b.celebName))
  );

  return summary;
}

function chooseBestDisplayName(group) {
  const candidates = [
    group.gpt.name,
    group.claude.name,
    group.deepseek.name,
    group.baseName,
  ].filter(isMeaningful);

  if (!candidates.length) return "[unnamed]";

  candidates.sort((a, b) => cleanName(b).length - cleanName(a).length);
  return cleanName(candidates[0]);
}

function getModelEntry(row, modelKey) {
  const cfg = MODEL_CONFIG[modelKey];
  return {
    name: isMeaningful(row[cfg.nameKey]) ? cleanName(row[cfg.nameKey]) : "",
    ocr: isMeaningful(row[cfg.ocrKey]) ? row[cfg.ocrKey] : "NA",
    modern: isMeaningful(row[cfg.modernKey]) ? row[cfg.modernKey] : "NA",
  };
}

function findExistingGroup(groups, candidateName) {
  const n = normName(candidateName);
  if (!n) return null;

  for (const group of groups) {
    if (normName(group.baseName) === n) return group;
    if (normName(group.gpt.name) === n) return group;
    if (normName(group.claude.name) === n) return group;
    if (normName(group.deepseek.name) === n) return group;
  }
  return null;
}

function alignPageRows(rows) {
  const groups = [];

  function createGroup(baseName = "") {
    const group = {
      baseName: cleanName(baseName),
      gpt: { name: "", ocr: "NA", modern: "NA" },
      claude: { name: "", ocr: "NA", modern: "NA" },
      deepseek: { name: "", ocr: "NA", modern: "NA" },
    };
    groups.push(group);
    return group;
  }

  rows.forEach(row => {
    const baseName = cleanName(row.aligned_person_name || row.name || "");

    const gptEntry = getModelEntry(row, "gpt");
    const claudeEntry = getModelEntry(row, "claude");
    const deepseekEntry = getModelEntry(row, "deepseek");

    const extractedNames = [
      gptEntry.name,
      claudeEntry.name,
      deepseekEntry.name,
      baseName,
    ].filter(isMeaningful);

    if (extractedNames.length) {
      let group = null;

      for (const candidateName of extractedNames) {
        group = findExistingGroup(groups, candidateName);
        if (group) break;
      }

      if (!group) {
        const preferredName =
          extractedNames.find(n => normName(n) !== normName(baseName)) ||
          extractedNames[0] ||
          baseName;
        group = createGroup(preferredName);
      }

      if (isMeaningful(gptEntry.name) || isMeaningful(gptEntry.modern)) group.gpt = gptEntry;
      if (isMeaningful(claudeEntry.name) || isMeaningful(claudeEntry.modern)) group.claude = claudeEntry;
      if (isMeaningful(deepseekEntry.name) || isMeaningful(deepseekEntry.modern)) group.deepseek = deepseekEntry;

      if (!isMeaningful(group.baseName) && isMeaningful(baseName)) {
        group.baseName = baseName;
      }
      return;
    }

    const fallbackGroup = createGroup(baseName);
    fallbackGroup.gpt = gptEntry;
    fallbackGroup.claude = claudeEntry;
    fallbackGroup.deepseek = deepseekEntry;
  });

  if (!groups.length) {
    const base = rows[0]?.aligned_person_name || rows[0]?.name || "[unnamed]";
    createGroup(base);
  }

  return groups.map(group => {
    const displayName = chooseBestDisplayName(group);
    const ocr =
      group.gpt.ocr !== "NA"
        ? group.gpt.ocr
        : group.claude.ocr !== "NA"
        ? group.claude.ocr
        : group.deepseek.ocr;

    return {
      name: displayName,
      ocr: ocr || "NA",
      gpt: group.gpt.modern || "NA",
      claude: group.claude.modern || "NA",
      deepseek: group.deepseek.modern || "NA",
    };
  });
}

async function loadCsv(datasetName) {
  const res = await fetch(datasetName);
  if (!res.ok) {
    throw new Error(`Could not load ${datasetName}`);
  }

  const text = await res.text();
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: results => resolve(results.data),
      error: err => reject(err),
    });
  });
}

function renderSummaryTable(rows) {
  const table = document.querySelector("#summaryTable tbody");
  const empty = document.getElementById("emptyState");
  table.innerHTML = "";

  if (!rows.length) {
    empty.style.display = "block";
    empty.textContent = "No rows found for this run.";
    return;
  }

  empty.style.display = "none";

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="sr-cell">${index + 1}</td>
      <td>${escapeHtml(row.title)}</td>
      <td>${escapeHtml(row.celebName)}</td>
      <td>${escapeHtml(row.year)}</td>
      <td>${escapeHtml(row.date)}</td>
      <td><a class="url-link" href="${escapeAttr(row.url)}" target="_blank" rel="noopener noreferrer">Open page</a></td>
      <td><span class="badge badge-count">${row.gptCount}</span></td>
      <td><span class="badge badge-count">${row.claudeCount}</span></td>
      <td><span class="badge badge-count">${row.deepseekCount}</span></td>
      <td><a class="result-link" href="results.html?page=${row.id}&dataset=${encodeURIComponent(row.dataset)}">View</a></td>
    `;
    table.appendChild(tr);
  });
}

function renderDetailPage(rows, targetKey, datasetName) {
  const grouped = groupRowsByPage(rows);
  const pageRows = grouped.get(decodeURIComponent(targetKey || "")) || [];
  const tbody = document.querySelector("#detailTable tbody");
  const empty = document.getElementById("detailEmpty");
  const meta = document.getElementById("pageMeta");
  const descriptorEl = document.getElementById("resultDescriptor");
  const backLink = document.getElementById("backLink");

  tbody.innerHTML = "";

  const datasetMeta = getDatasetMeta(datasetName);
  if (descriptorEl) {
    descriptorEl.textContent = datasetMeta.descriptor;
  }

  if (backLink) {
    backLink.href = `index.html?dataset=${encodeURIComponent(datasetName)}`;
  }

  if (!pageRows.length) {
    empty.style.display = "block";
    meta.textContent = "No matching page found.";
    return;
  }

  empty.style.display = "none";
  const first = pageRows[0];
  const title = deriveTitle(first);
  const celebName = deriveCelebName(first);
  meta.textContent = `${title} · ${celebName} · ${first.date_of_publication || ""} · ${first.page_year || ""}`;

  const aligned = alignPageRows(pageRows);
  aligned.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="sr-cell">${index + 1}</td>
      <td>${escapeHtml(row.name)}</td>
      <td class="prewrap">${escapeHtml(row.ocr || "NA")}</td>
      <td class="prewrap">${escapeHtml(row.gpt || "NA")}</td>
      <td class="prewrap">${escapeHtml(row.claude || "NA")}</td>
      <td class="prewrap">${escapeHtml(row.deepseek || "NA")}</td>
    `;
    tbody.appendChild(tr);
  });
}

function setupSearch(allRowsGetter) {
  const input = document.getElementById("searchInput");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    const rows = allRowsGetter();
    const filtered = !q
      ? rows
      : rows.filter(r =>
          [r.title, r.celebName, r.year, r.date].some(v =>
            String(v).toLowerCase().includes(q)
          )
        );
    renderSummaryTable(filtered);
  });
}

function updateTabUI(datasetName) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.dataset === datasetName);
  });

  const meta = getDatasetMeta(datasetName);
  const descriptor = document.getElementById("runDescriptor");
  const datasetPill = document.getElementById("datasetPill");

  if (descriptor) descriptor.textContent = meta.descriptor;
  if (datasetPill) datasetPill.textContent = meta.label;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

async function initIndexPage() {
  const params = new URLSearchParams(window.location.search);
  let currentDataset = params.get("dataset") || "competition_results.csv";

  if (!DATASETS[currentDataset]) {
    currentDataset = "competition_results.csv";
  }

  let currentSummaryRows = [];

  async function loadAndRender(datasetName) {
    currentDataset = datasetName;
    updateTabUI(datasetName);

    const rows = await loadCsv(datasetName);
    currentSummaryRows = buildSummaryRows(rows, datasetName);
    renderSummaryTable(currentSummaryRows);

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("dataset", datasetName);
    window.history.replaceState({}, "", newUrl.toString());
  }

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await loadAndRender(btn.dataset.dataset);
    });
  });

  setupSearch(() => currentSummaryRows);
  await loadAndRender(currentDataset);
}

async function initResultsPage() {
  const params = new URLSearchParams(window.location.search);
  const targetKey = params.get("page");
  let datasetName = params.get("dataset") || "competition_results.csv";

  if (!DATASETS[datasetName]) {
    datasetName = "competition_results.csv";
  }

  const rows = await loadCsv(datasetName);
  renderDetailPage(rows, targetKey, datasetName);
}

async function init() {
  const isResultsPage = window.location.pathname.endsWith("results.html");
  if (isResultsPage) {
    await initResultsPage();
  } else {
    await initIndexPage();
  }
}

init();