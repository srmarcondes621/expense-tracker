const { randomUUID } = require("node:crypto");
const { parseExpenseLine } = require("../lib/parse-line");
const { getCycleKey } = require("../lib/cycle");
const { categorize } = require("../lib/categorize");
const { deriveExpenseTags } = require("../lib/tags");
const {
  readLedger,
  readCategoriesConfig,
  appendLedgerEntry,
  appendLedgerEntries,
} = require("../lib/github-ledger");
const { parseWhatsAppBulk } = require("../lib/whatsapp-bulk");
const REPEAT_KEYS = ["condominio", "guardioes", "vivo", "prevent"];

function corsHeaders(req) {
  const allowed = process.env.ALLOWED_ORIGINS || "";
  const origin = req.headers.origin;
  let allowOrigin = "*";
  if (allowed.trim()) {
    const list = allowed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (origin && list.includes(origin)) allowOrigin = origin;
    else if (list.length === 1) allowOrigin = list[0];
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * @param {object} e
 * @returns {object | null}
 */
function normalizeStoredEntry(e, catConfig) {
  if (!e || typeof e !== "object") return null;
  const rawDate = e.date || e.createdAt;
  if (!rawDate) return null;
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return null;
  const desc = String(e.description || "");
  const cycleKey = e.cycleKey || getCycleKey(d);
  let tags;
  if (
    Array.isArray(e.tags) &&
    e.tags.length > 0 &&
    e.tags.every((t) => typeof t === "string")
  ) {
    tags = e.tags;
  } else {
    tags = deriveExpenseTags(desc);
  }
  const rawCategory = String(e.category || "Outros");
  let category = rawCategory;
  if (category === "Transporte") category = "Uber";
  if (category === "Saúde") category = "Saude / Farmacia";
  if (category === "Alimentação") category = "Mercado";
  if (category === "Lazer") category = "Lazer / Outros";
  if (
    catConfig &&
    (rawCategory === "Outros" ||
      rawCategory === "Saúde" ||
      rawCategory === "Saude / Farmacia" ||
      rawCategory === "Lazer")
  ) {
    const recat = categorize(desc, catConfig);
    if (recat && recat !== "Outros") {
      category = recat;
    }
  }
  return {
    id: e.id,
    date: d.toISOString(),
    description: desc,
    amount: typeof e.amount === "number" ? e.amount : parseFloat(e.amount),
    category,
    cycleKey,
    tags,
  };
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getRepeatKey(description) {
  const t = normalizeText(description);
  for (const k of REPEAT_KEYS) {
    if (t.includes(k)) return k;
  }
  return null;
}

function previousCycleKey(cycleKey) {
  const [ys, ms] = String(cycleKey).split("-").map(Number);
  let y = ys;
  let m = ms - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

module.exports = async (req, res) => {
  const c = corsHeaders(req);
  for (const [k, v] of Object.entries(c)) {
    res.setHeader(k, v);
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const ledgerPath = process.env.LEDGER_PATH || "data/ledger.json";

  if (!token || !owner || !repo) {
    return res.status(500).json({
      error:
        "Missing env: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO must be set on the server.",
    });
  }

  try {
    if (req.method === "GET") {
      const { ledger } = await readLedger(token, owner, repo, ledgerPath);
      const catConfig = await readCategoriesConfig(token, owner, repo);
      const normalized = ledger.entries
        .map((e) => normalizeStoredEntry(e, catConfig))
        .filter(Boolean);
      const entries = normalized.sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );
      const cycleSet = new Set(entries.map((e) => e.cycleKey));
      cycleSet.add(getCycleKey(new Date()));
      const cycles = Array.from(cycleSet).sort().reverse();
      return res.status(200).json({
        entries,
        cycles,
        updatedAt: ledger.updatedAt,
        ledgerPath,
      });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (body == null) body = {};
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }

      if (body.action === "repeatRecurring") {
        const { ledger } = await readLedger(token, owner, repo, ledgerPath);
        const catConfig = await readCategoriesConfig(token, owner, repo);
        const normalized = ledger.entries
          .map((e) => normalizeStoredEntry(e, catConfig))
          .filter(Boolean);

        const currentCycle = getCycleKey(new Date());
        const prevCycle = previousCycleKey(currentCycle);

        const currentKeys = new Set(
          normalized
            .filter((e) => e.cycleKey === currentCycle)
            .map((e) => getRepeatKey(e.description))
            .filter(Boolean)
        );

        const latestPrevByKey = new Map();
        for (const e of normalized) {
          if (e.cycleKey !== prevCycle) continue;
          const key = getRepeatKey(e.description);
          if (!key) continue;
          const prev = latestPrevByKey.get(key);
          if (!prev || new Date(e.date) > new Date(prev.date)) {
            latestPrevByKey.set(key, e);
          }
        }

        const toAdd = [];
        const skippedKeys = [];
        for (const key of REPEAT_KEYS) {
          const src = latestPrevByKey.get(key);
          if (!src) continue;
          if (currentKeys.has(key)) {
            skippedKeys.push(key);
            continue;
          }

          const shifted = new Date(src.date);
          shifted.setMonth(shifted.getMonth() + 1);
          const date = getCycleKey(shifted) === currentCycle ? shifted : new Date();
          toAdd.push({
            id: randomUUID(),
            date: date.toISOString(),
            description: src.description,
            amount: Math.round(src.amount * 100) / 100,
            category: src.category,
            cycleKey: currentCycle,
            tags:
              Array.isArray(src.tags) && src.tags.length
                ? src.tags
                : deriveExpenseTags(src.description),
          });
        }

        if (toAdd.length) {
          await appendLedgerEntries({
            token,
            owner,
            repo,
            ledgerPath,
            entries: toAdd,
          });
        }

        return res.status(200).json({
          ok: true,
          action: "repeatRecurring",
          addedCount: toAdd.length,
          entries: toAdd,
          skippedKeys,
          sourceCycle: prevCycle,
          targetCycle: currentCycle,
        });
      }

      const bulkRaw = body.bulk;
      if (bulkRaw != null && String(bulkRaw).trim()) {
        const parsed = parseWhatsAppBulk(String(bulkRaw));
        if (parsed.error) {
          return res.status(400).json({
            error: parsed.error,
            skipped: parsed.skipped,
            cancelledCount: parsed.cancelledCount,
          });
        }
        if (!parsed.entries.length) {
          return res.status(400).json({
            error: "Nenhum lançamento reconhecido na cola.",
            skipped: parsed.skipped,
            cancelledCount: parsed.cancelledCount,
          });
        }

        const catConfig = await readCategoriesConfig(token, owner, repo);
        const ledgerEntries = parsed.entries.map((draft) => {
          const date = new Date(draft.dateISO);
          const category = categorize(draft.description, catConfig);
          const cycleKey = getCycleKey(date);
          const amt = Math.round(draft.amount * 100) / 100;
          return {
            id: randomUUID(),
            date: date.toISOString(),
            description: draft.description,
            amount: amt,
            category,
            cycleKey,
            tags: deriveExpenseTags(draft.description),
          };
        });

        await appendLedgerEntries({
          token,
          owner,
          repo,
          ledgerPath,
          entries: ledgerEntries,
        });

        const totalAmount =
          Math.round(
            ledgerEntries.reduce((s, e) => s + e.amount, 0) * 100
          ) / 100;

        return res.status(201).json({
          ok: true,
          entries: ledgerEntries,
          addedCount: ledgerEntries.length,
          skipped: parsed.skipped,
          cancelledCount: parsed.cancelledCount,
          summary: { totalAmount },
        });
      }

      const line = body.line;
      const descriptionIn = body.description;
      const amountIn = body.amount;
      let dateStr = body.date;

      let parsed;
      if (line != null && String(line).trim()) {
        parsed = parseExpenseLine(String(line));
        if (!parsed) {
          return res
            .status(400)
            .json({ error: "Invalid line. Use: Descrição- valor (ex: Uber- 35,93)" });
        }
      } else if (descriptionIn != null && amountIn != null) {
        parsed = parseExpenseLine(`${String(descriptionIn).trim()}- ${amountIn}`);
        if (!parsed) {
          return res.status(400).json({ error: "Invalid description or amount" });
        }
      } else {
        return res.status(400).json({
          error: 'Envie JSON: { "bulk": "..." }, { "line": "..." } ou { "description", "amount", "date?" }',
        });
      }

      const date = dateStr ? new Date(String(dateStr)) : new Date();
      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({ error: "Invalid date" });
      }

      const catConfig = await readCategoriesConfig(token, owner, repo);
      const category = categorize(parsed.description, catConfig);
      const cycleKey = getCycleKey(date);
      const amt = Math.round(parsed.amount * 100) / 100;

      const entry = {
        id: randomUUID(),
        date: date.toISOString(),
        description: parsed.description,
        amount: amt,
        category,
        cycleKey,
        tags: deriveExpenseTags(parsed.description),
      };

      await appendLedgerEntry({
        token,
        owner,
        repo,
        ledgerPath,
        entry,
      });

      return res.status(201).json({ entry, ok: true });
    }

    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[api/entries]", e);
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({
      error: e.message || "Internal error",
    });
  }
};
