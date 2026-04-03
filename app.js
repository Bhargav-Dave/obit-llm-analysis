const STORAGE_KEY = "competition_csv_text_v1";

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

function isMeaningful(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  return s !== "" && s.toUpperCase() !== "NA";
}

function normName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\[.*?\]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageKey(row) {
  return [row.newspaper_url, row.date_of_publication, row.page_year].join("||");
}

function deriveTitle(row) {
  return row.name || "Untitled page";
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

function buildSummaryRows(rows) {
  const grouped = groupRowsByPage(rows);
  const summary = [];

  for (const [key, pageRows] of grouped.entries()) {
    const first = pageRows[0];
    summary.push({
      id: encodeURIComponent(key),
      title: deriveTitle(first),
      year: first.page_year || "",
      date: first.date_of_publication || "",
      url: first.newspaper_url || "",
      claudeCount: countModelObits(pageRows, "claude"),
      deepseekCount: countModelObits(pageRows, "deepseek"),
      gptCount: countModelObits(pageRows, "gpt"),
    });
  }

  summary.sort((a, b) => String(a.year).localeCompare(String(b.year)) || String(a.date).localeCompare(String(b.date)));
  return summary;
}

function chooseDisplayName(group) {
  return (
    group.baseName ||
    group.gpt.name ||
    group.claude.name ||
    group.deepseek.name ||
    "[unnamed]"
  );
}

function alignPageRows(rows) {
  const aligned = [];
  const usedGroups = new Map();

  function getOrCreateGroup(name, baseName = "") {
    const key = normName(name || baseName || "") || `__group_${aligned.length}_${Math.random().toString(36).slice(2, 7)}`;
    if (usedGroups.has(key)) return usedGroups.get(key);
    const g = {
      key,
      baseName,
      gpt: { name: "", ocr: "", modern: "" },
      claude: { name: "", ocr: "", modern: "" },
      deepseek: { name: "", ocr: "", modern: "" },
    };
    usedGroups.set(key, g);
    aligned.push(g);
    return g;
  }

  rows.forEach(row => {
    const baseName = row.name || "";
    for (const [modelKey, cfg] of Object.entries(MODEL_CONFIG)) {
      const modelName = row[cfg.nameKey];
      if (!isMeaningful(modelName)) continue;
      const group = getOrCreateGroup(modelName, baseName);
      group[modelKey] = {
        name: modelName,
        ocr: row[cfg.ocrKey] || "NA",
        modern: row[cfg.modernKey] || "NA",
      };
    }
  });

  if (aligned.length === 0) {
    const base = rows[0]?.name || "[unnamed]";
    aligned.push({
      key: normName(base) || "__empty__",
      baseName: base,
      gpt: { name: "", ocr: "NA", modern: "NA" },
      claude: { name: "", ocr: "NA", modern: "NA" },
      deepseek: { name: "", ocr: "NA", modern: "NA" },
    });
  }

  return aligned.map(group => ({
    name: chooseDisplayName(group),
    ocr: group.gpt.ocr !== "NA" ? group.gpt.ocr : (group.claude.ocr !== "NA" ? group.claude.ocr : group.deepseek.ocr),
    claude: group.claude.modern || "NA",
    gpt: group.gpt.modern || "NA",
    deepseek: group.deepseek.modern || "NA",
  }));
}

function renderSummaryTable(rows) {
  const table = document.querySelector("#summaryTable tbody");
  const empty = document.getElementById("emptyState");
  table.innerHTML = "";

  if (!rows.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.title)}</td>
      <td>${escapeHtml(row.year)}</td>
      <td>${escapeHtml(row.date)}</td>
      <td><a class="url-link" href="${escapeAttr(row.url)}" target="_blank" rel="noopener noreferrer">Open page</a></td>
      <td><span class="badge">${row.claudeCount}</span></td>
      <td><span class="badge">${row.deepseekCount}</span></td>
      <td><span class="badge">${row.gptCount}</span></td>
      <td><a class="result-link" href="results.html?page=${row.id}">View</a></td>
    `;
    table.appendChild(tr);
  });
}

function renderDetailPage(rows, targetKey) {
  const grouped = groupRowsByPage(rows);
  const pageRows = grouped.get(decodeURIComponent(targetKey || "")) || [];
  const tbody = document.querySelector("#detailTable tbody");
  const empty = document.getElementById("detailEmpty");
  const meta = document.getElementById("pageMeta");
  tbody.innerHTML = "";

  if (!pageRows.length) {
    empty.style.display = "block";
    meta.textContent = "No matching page found.";
    return;
  }

  empty.style.display = "none";
  const first = pageRows[0];
  meta.textContent = `${first.name || "Untitled page"} · ${first.date_of_publication || ""} · ${first.page_year || ""}`;

  const aligned = alignPageRows(pageRows);
  aligned.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td class="prewrap">${escapeHtml(row.ocr || "NA")}</td>
      <td class="prewrap">${escapeHtml(row.claude || "NA")}</td>
      <td class="prewrap">${escapeHtml(row.gpt || "NA")}</td>
      <td class="prewrap">${escapeHtml(row.deepseek || "NA")}</td>
    `;
    tbody.appendChild(tr);
  });
}

function parseCsvText(text) {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: results => resolve(results.data),
      error: err => reject(err),
    });
  });
}

async function loadDefaultCsv() {
  try {
    const res = await fetch("competition_results.csv");
    if (!res.ok) throw new Error("No default CSV found");
    const text = await res.text();
    localStorage.setItem(STORAGE_KEY, text);
    return await parseCsvText(text);
  } catch {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) return await parseCsvText(cached);
    return [];
  }
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

function setupCsvInput(onRows) {
  const input = document.getElementById("csvFile");
  if (!input) return;

  input.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    localStorage.setItem(STORAGE_KEY, text);
    const rows = await parseCsvText(text);
    onRows(rows);
  });
}

function setupSearch(summaryRows) {
  const input = document.getElementById("searchInput");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    const filtered = !q ? summaryRows : summaryRows.filter(r =>
      [r.title, r.year, r.date].some(v => String(v).toLowerCase().includes(q))
    );
    renderSummaryTable(filtered);
  });
}

async function init() {
  const rows = await loadDefaultCsv();
  const isResultsPage = location.pathname.endsWith("results.html");

  if (isResultsPage) {
    const params = new URLSearchParams(location.search);
    renderDetailPage(rows, params.get("page"));
    return;
  }

  const summaryRows = buildSummaryRows(rows);
  renderSummaryTable(summaryRows);
  setupSearch(summaryRows);
  setupCsvInput(newRows => {
    const newSummary = buildSummaryRows(newRows);
    renderSummaryTable(newSummary);
    setupSearch(newSummary);
  });
}

init();