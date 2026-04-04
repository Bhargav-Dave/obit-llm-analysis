const STORAGE_KEY = "competition_csv_text_v3";

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
  return [row.newspaper_url, row.date_of_publication, row.page_year].join("||");
}

function deriveTitle(row) {
  if (isMeaningful(row.newspaper_title)) return row.newspaper_title;
  if (isMeaningful(row.name)) return row.name;
  return "Untitled page";
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
      gptCount: countModelObits(pageRows, "gpt"),
      claudeCount: countModelObits(pageRows, "claude"),
      deepseekCount: countModelObits(pageRows, "deepseek"),
    });
  }

  summary.sort((a, b) =>
    String(a.year).localeCompare(String(b.year)) ||
    String(a.date).localeCompare(String(b.date)) ||
    String(a.title).localeCompare(String(b.title))
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
      <td><span class="badge">${row.gptCount}</span></td>
      <td><span class="badge">${row.claudeCount}</span></td>
      <td><span class="badge">${row.deepseekCount}</span></td>
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
  const title = deriveTitle(first);
  meta.textContent = `${title} · ${first.date_of_publication || ""} · ${first.page_year || ""}`;

  const aligned = alignPageRows(pageRows);
  aligned.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td class="prewrap">${escapeHtml(row.ocr || "NA")}</td>
      <td class="prewrap">${escapeHtml(row.gpt || "NA")}</td>
      <td class="prewrap">${escapeHtml(row.claude || "NA")}</td>
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
    const filtered = !q
      ? summaryRows
      : summaryRows.filter(r =>
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