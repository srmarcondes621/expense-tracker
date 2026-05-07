(function () {
  "use strict";

  const MESSAGES_MAX = 50;

  /** API base: same origin on Vercel, or set window.__EXPENSE_API_BASE__ (e.g. GitHub Pages). */
  const API_BASE = (window.__EXPENSE_API_BASE__ || "").replace(/\/$/, "");

  /** @type {{ categories: { name: string; keywords: string[] }[]; fallbackCategory: string }} */
  let categoryConfig = {
    categories: [],
    fallbackCategory: "Outros",
  };

  /** @type {any[]} */
  let cachedEntries = [];
  /** @type {string | null} */
  let selectedCycleKey = null;

  const els = {
    messages: document.getElementById("messages"),
    composer: document.getElementById("composer"),
    lineInput: document.getElementById("line-input"),
    errorMsg: document.getElementById("error-msg"),
    cycleTabs: document.getElementById("cycle-tabs"),
    totalsBody: document.getElementById("totals-body"),
    simoneTotal: document.getElementById("simone-total"),
    grandTotal: document.getElementById("grand-total"),
    entriesList: document.getElementById("entries-list"),
    exportCsv: document.getElementById("export-csv"),
    dataStatus: document.getElementById("data-status"),
    submitBtn: null,
  };

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function getEntryDate(e) {
    return e.date || e.createdAt;
  }

  /**
   * @param {Date} date
   * @returns {string}
   */
  function getCycleKey(date) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    let y = d.getFullYear();
    let m = d.getMonth();
    if (day < 10) {
      m -= 1;
      if (m < 0) {
        m = 11;
        y -= 1;
      }
    }
    return `${y}-${String(m + 1).padStart(2, "0")}`;
  }

  function formatCycleRange(cycleKey) {
    const [ys, ms] = cycleKey.split("-").map(Number);
    const start = new Date(ys, ms - 1, 10);
    const end = new Date(ys, ms, 9);
    const fmt = new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return `${fmt.format(start)} — ${fmt.format(end)}`;
  }

  /** Rótulo curto para abas em telas estreitas (evita texto longo no scroll horizontal). */
  function formatCycleTabShort(cycleKey) {
    const [ys, ms] = cycleKey.split("-").map(Number);
    const monthNames = [
      "Janeiro",
      "Fevereiro",
      "Março",
      "Abril",
      "Maio",
      "Junho",
      "Julho",
      "Agosto",
      "Setembro",
      "Outubro",
      "Novembro",
      "Dezembro",
    ];
    const month = monthNames[(ms || 1) - 1] || cycleKey;
    const year2 = String(ys || "").slice(-2);
    return `${month} ${year2}`;
  }

  function compactCycleTabs() {
    return window.matchMedia("(max-width: 540px)").matches;
  }

  function setDataStatus(text, kind) {
    if (!els.dataStatus) return;
    els.dataStatus.textContent = text;
    els.dataStatus.classList.remove("is-ok", "is-err");
    if (kind === "ok") els.dataStatus.classList.add("is-ok");
    if (kind === "err") els.dataStatus.classList.add("is-err");
  }

  async function fetchEntriesFromApi() {
    const res = await fetch(apiUrl("/api/entries"), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText || "Falha ao carregar");
    }
    return res.json();
  }

  async function refreshEntries() {
    setDataStatus("Sincronizando com GitHub…", null);
    try {
      const data = await fetchEntriesFromApi();
      cachedEntries = Array.isArray(data.entries) ? data.entries : [];
      rebuildCycleTabs(cachedEntries);
      renderConsolidation(cachedEntries);
      renderEntriesList(cachedEntries);
      setDataStatus(
        `Sincronizado (${cachedEntries.length} lançamentos).`,
        "ok"
      );
      showError("");
    } catch (e) {
      setDataStatus(`Erro: ${e.message}`, "err");
      throw e;
    }
  }

  /**
   * @param {string} line
   * @returns {{ description: string; amount: number } | null}
   */
  function parseExpenseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const parts = trimmed
      .split("-")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) return null;

    let amountIdx = -1;
    let amount = NaN;
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i].replace(/\s/g, "").replace(",", ".");
      if (!/^\d+(\.\d+)?$/.test(candidate)) continue;
      const parsed = parseFloat(candidate);
      if (Number.isFinite(parsed) && parsed >= 0) {
        amountIdx = i;
        amount = parsed;
        break;
      }
    }

    if (amountIdx < 0) return null;
    const description = parts
      .filter((_, idx) => idx !== amountIdx)
      .join(" - ")
      .trim();
    if (!description) return null;
    return { description, amount };
  }

  function normalizeForMatch(text) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function categorize(description) {
    const norm = normalizeForMatch(description);
    const list = categoryConfig.categories || [];
    for (const cat of list) {
      const name = cat.name;
      if (!cat.keywords || !cat.keywords.length) continue;
      for (const kw of cat.keywords) {
        if (norm.includes(normalizeForMatch(kw))) return name;
      }
    }
    return categoryConfig.fallbackCategory || "Outros";
  }

  function showError(message) {
    if (!message) {
      els.errorMsg.hidden = true;
      els.errorMsg.textContent = "";
      return;
    }
    els.errorMsg.hidden = false;
    els.errorMsg.textContent = message;
  }

  function formatMoney(n) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(n);
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  function addMessageBubble(text, meta) {
    const div = document.createElement("div");
    div.className = "message";
    div.textContent = text;
    if (meta) {
      const m = document.createElement("span");
      m.className = "message-meta";
      m.textContent = meta;
      div.appendChild(m);
    }
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
    while (els.messages.children.length > MESSAGES_MAX) {
      els.messages.removeChild(els.messages.firstChild);
    }
  }

  function getUniqueCycleKeys(entries) {
    const set = new Set(entries.map((e) => e.cycleKey));
    const current = getCycleKey(new Date());
    set.add(current);
    return Array.from(set).sort().reverse();
  }

  function getSelectedCycle() {
    return selectedCycleKey || getCycleKey(new Date());
  }

  function rebuildCycleTabs(entries) {
    const prev = selectedCycleKey;
    const keys = getUniqueCycleKeys(entries);
    const current = getCycleKey(new Date());
    els.cycleTabs.innerHTML = "";

    for (const k of keys) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cycle-tab";
      btn.setAttribute("role", "tab");
      btn.dataset.cycle = k;
      const tabLabel = formatCycleTabShort(k);
      const fullLabel = `${tabLabel} · ${formatCycleRange(k)}`;
      btn.title = fullLabel;
      btn.setAttribute("aria-label", fullLabel);
      btn.textContent = tabLabel;
      btn.setAttribute("aria-selected", "false");
      btn.addEventListener("click", () => {
        selectedCycleKey = k;
        rebuildCycleTabs(cachedEntries);
        renderConsolidation(cachedEntries);
      });
      els.cycleTabs.appendChild(btn);
    }

    if (prev && keys.includes(prev)) selectedCycleKey = prev;
    else if (keys.includes(current)) selectedCycleKey = current;
    else if (keys.length) selectedCycleKey = keys[0];

    const active = getSelectedCycle();
    els.cycleTabs.querySelectorAll(".cycle-tab").forEach((b) => {
      const on = b.dataset.cycle === active;
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function entryHasSimoneTag(e) {
    return Array.isArray(e.tags) && e.tags.includes("Simone");
  }

  function renderTagBadges(entry) {
    if (!Array.isArray(entry.tags) || entry.tags.length === 0) return "";
    const classByTag = {
      Simone: "tag-simone",
      "Cartao Sergio": "tag-cartao-sergio",
      Santander: "tag-santander",
    };
    return entry.tags
      .map((tag) => {
        const safeTag = escapeHtml(String(tag));
        const cls = classByTag[tag] || "tag-generic";
        return `<span class="tag-pill ${cls}" aria-label="Marcado ${safeTag}">${safeTag}</span>`;
      })
      .join("");
  }

  function groupByCategory(entriesInCycle) {
    /** @type {Record<string, number>} */
    const map = {};
    for (const e of entriesInCycle) {
      const c = e.category || categoryConfig.fallbackCategory;
      map[c] = (map[c] || 0) + e.amount;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }

  function renderConsolidation(entries) {
    const cycle = getSelectedCycle();
    const inCycle = entries.filter((e) => e.cycleKey === cycle);
    const groups = groupByCategory(inCycle);
    els.totalsBody.innerHTML = "";
    let sum = 0;
    for (const [cat, total] of groups) {
      sum += total;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(cat)}</td><td class="num">${formatMoney(total)}</td>`;
      els.totalsBody.appendChild(tr);
    }
    if (groups.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td colspan="2" style="color:var(--muted)">Nenhum lançamento neste ciclo.</td>';
      els.totalsBody.appendChild(tr);
    }

    let simoneSum = 0;
    for (const e of inCycle) {
      if (entryHasSimoneTag(e)) simoneSum += e.amount;
    }
    if (els.simoneTotal) els.simoneTotal.textContent = formatMoney(simoneSum);
    els.grandTotal.textContent = formatMoney(sum);
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function renderEntriesList(entries) {
    const sorted = [...entries].sort(
      (a, b) => new Date(getEntryDate(b)) - new Date(getEntryDate(a))
    );
    els.entriesList.innerHTML = "";
    for (const e of sorted.slice(0, 100)) {
      const li = document.createElement("li");
      const badges = renderTagBadges(e);
      li.innerHTML = `
        <span class="desc">${escapeHtml(e.description)}</span>
        <span class="cat">${badges}${escapeHtml(e.category)} · ${e.cycleKey}</span>
        <span class="amt">${formatMoney(e.amount)}</span>
        <span class="when">${escapeHtml(formatDateTime(getEntryDate(e)))}</span>
      `;
      els.entriesList.appendChild(li);
    }
  }

  function setLoading(loading) {
    if (els.submitBtn) els.submitBtn.disabled = loading;
    if (els.lineInput) els.lineInput.disabled = loading;
  }

  function shouldUseBulk(text) {
    const v = String(text);
    if (v.includes("\n")) return true;
    if (/\[\d{1,2}\/\d{1,2}\/\d{2,4},/.test(v)) return true;
    if (v.length > 400) return true;
    return false;
  }

  async function addBulkFromText(bulk) {
    setLoading(true);
    showError("");
    try {
      const res = await fetch(apiUrl("/api/entries"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ bulk: String(bulk) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || `Erro ao importar (${res.status})`);
        return false;
      }
      const n = data.addedCount ?? data.entries?.length ?? 0;
      const sk = Array.isArray(data.skipped) ? data.skipped.length : 0;
      const cancel = data.cancelledCount ?? 0;
      const tot = data.summary?.totalAmount ?? 0;
      const totFmt = formatMoney(tot);
      const metaBits = [];
      if (sk) metaBits.push(`${sk} linhas ignoradas`);
      if (cancel) metaBits.push(`${cancel} cancelamento(s)`);
      addMessageBubble(`${n} lançamentos adicionados`, `${metaBits.join(" · ") || "Importação"} · Total ${totFmt}`);
      setDataStatus(
        `${n} adicionados${sk ? `, ${sk} ignoradas` : ""} · Total ${totFmt}`,
        "ok"
      );
      els.lineInput.value = "";
      await refreshEntries();
      return true;
    } catch (e) {
      showError(e.message || "Falha de rede");
      setDataStatus(`Erro: ${e.message}`, "err");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function submitFromComposer() {
    const raw = els.lineInput.value;
    if (!String(raw).trim()) return;
    if (shouldUseBulk(raw)) {
      await addBulkFromText(raw);
    } else {
      await addEntryFromLine(raw);
    }
    els.lineInput.focus();
  }

  async function addEntryFromLine(line) {
    const parsed = parseExpenseLine(line);
    if (!parsed) {
      showError('Formato inválido. Use: Descrição- valor (ex: Uber- 35,93).');
      return false;
    }
    setLoading(true);
    showError("");
    try {
      const res = await fetch(apiUrl("/api/entries"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ line: line.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || `Erro ao salvar (${res.status})`);
        return false;
      }
      const entry = data.entry;
      const when = getEntryDate(entry);
      const previewCat =
        entry && entry.category != null
          ? entry.category
          : categorize(parsed.description);
      addMessageBubble(
        `${parsed.description}: ${formatMoney(entry.amount)}`,
        `${previewCat} · Ciclo ${entry.cycleKey}`
      );
      els.lineInput.value = "";
      await refreshEntries();
      return true;
    } catch (e) {
      showError(e.message || "Falha de rede");
      setDataStatus(`Erro: ${e.message}`, "err");
      return false;
    } finally {
      setLoading(false);
    }
  }

  function exportCsvForSelectedCycle() {
    const cycle = getSelectedCycle();
    const inCycle = cachedEntries.filter((e) => e.cycleKey === cycle);
    const header = ["description", "amount", "category", "date", "cycleKey", "tags"];
    const rows = [header.join(",")];
    for (const e of inCycle.sort(
      (a, b) => new Date(getEntryDate(a)) - new Date(getEntryDate(b))
    )) {
      const tagsCell =
        Array.isArray(e.tags) && e.tags.length ? e.tags.join(";") : "";
      rows.push(
        [
          csvEscape(e.description),
          String(e.amount).replace(".", ","),
          csvEscape(e.category),
          csvEscape(getEntryDate(e)),
          csvEscape(e.cycleKey),
          csvEscape(tagsCell),
        ].join(",")
      );
    }
    const blob = new Blob(["\ufeff" + rows.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gastos-${cycle}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function csvEscape(s) {
    const t = String(s);
    if (/[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
    return t;
  }

  async function loadCategories() {
    try {
      const res = await fetch("categories.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      categoryConfig = await res.json();
    } catch {
      categoryConfig = {
        categories: [{ name: "Outros", keywords: [] }],
        fallbackCategory: "Outros",
      };
    }
  }

  async function init() {
    els.submitBtn = els.composer.querySelector('button[type="submit"]');

    await loadCategories();
    els.composer.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await submitFromComposer();
    });
    els.exportCsv.addEventListener("click", exportCsvForSelectedCycle);

    try {
      await refreshEntries();
    } catch {
      cachedEntries = [];
      rebuildCycleTabs(cachedEntries);
      renderConsolidation(cachedEntries);
      renderEntriesList(cachedEntries);
    }

    const mq = window.matchMedia("(max-width: 540px)");
    const onMq = () => {
      rebuildCycleTabs(cachedEntries);
      renderConsolidation(cachedEntries);
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onMq);
    } else if (typeof mq.addListener === "function") {
      mq.addListener(onMq);
    }
  }

  init();
})();
