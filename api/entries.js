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
function normalizeStoredEntry(e) {
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
  const category = rawCategory === "Transporte" ? "Uber" : rawCategory;
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
      const normalized = ledger.entries
        .map(normalizeStoredEntry)
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
