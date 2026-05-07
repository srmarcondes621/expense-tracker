const { parseExpenseLine } = require("./parse-line");

const MAX_BULK_CHARS = 120_000;
const MAX_PARSED_EXPENSES = 500;

/**
 * @param {number} yy
 */
function expandYear(yy) {
  if (yy >= 100) return yy;
  return yy <= 69 ? 2000 + yy : 1900 + yy;
}

/**
 * @param {RegExpMatchArray} m Header match (full re with groups day,month,year,hh,mm,ss)
 */
function matchToBrazilISO(m) {
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const yearRaw = parseInt(m[3], 10);
  const y = expandYear(yearRaw);
  const hh = parseInt(m[4], 10);
  const mm = parseInt(m[5], 10);
  const ss = parseInt(m[6], 10);
  const Y = String(y).padStart(4, "0");
  const Mo = String(month).padStart(2, "0");
  const D = String(day).padStart(2, "0");
  const H = String(hh).padStart(2, "0");
  const M = String(mm).padStart(2, "0");
  const S = String(ss).padStart(2, "0");
  return `${Y}-${Mo}-${D}T${H}:${M}:${S}-03:00`;
}

/**
 * One physical line may contain multiple WhatsApp messages; each gets a body slice and timestamp.
 * @param {string} line
 * @returns {{ dateISO: string; body: string }[]}
 */
function extractWhatsAppSegments(line) {
  const re =
    /\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{1,2}):(\d{1,2})\]\s*[^:]+:\s*/g;
  const matches = [...line.matchAll(re)];
  const segments = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : line.length;
    const body = line.slice(start, end).trim();
    const dateISO = matchToBrazilISO(m);
    segments.push({ dateISO, body });
  }
  return segments;
}

/**
 * @param {string} text
 */
function isCancelLine(text) {
  return /^cancelad[oa]\b/i.test(text.trim());
}

/**
 * @param {string} text
 */
function isNoiseMessage(text) {
  const t = text.trim();
  if (!t) return true;
  const lower = t.toLowerCase();

  if (/read\s*more/i.test(t)) return true;

  if (/^https?:\/\//i.test(t.trim())) return true;

  if (/https?:\/\//i.test(t)) {
    const asExpense = parseExpenseLine(t);
    if (!asExpense) return true;
  }

  if (/^add all the expenses\b/i.test(lower)) return true;
  if (/\btabulate\b/i.test(lower) && /\bsummary\b/i.test(lower)) return true;
  if (/^ignore the rest\b/i.test(lower)) return true;
  if (/^mês\s+/i.test(t)) return true;

  if (/^(ta|tá|sim|não|nao|ok|ótimo|otimo|obrigad[oa]|q\s+bom|entendi)\.?$/i.test(t))
    return true;

  if (t.length <= 2 && !t.includes("-")) return true;

  if (t.length > 800 && /https?:\/\//i.test(t) && !parseExpenseLine(t)) return true;

  return false;
}

/**
 * @param {string} text
 */
function parseWhatsAppBulk(text) {
  if (typeof text !== "string") {
    return {
      entries: [],
      skipped: [],
      cancelledCount: 0,
      error: "bulk must be a string",
    };
  }
  if (text.length > MAX_BULK_CHARS) {
    return {
      entries: [],
      skipped: [],
      cancelledCount: 0,
      error: `Cola no máximo ${MAX_BULK_CHARS} caracteres`,
    };
  }

  const lines = text.split(/\r?\n/u);
  /** @type {{ description: string; amount: number; dateISO: string }[]} */
  const accepted = [];
  /** @type {{ line: string; reason: string }[]} */
  const skipped = [];
  let cancelledCount = 0;

  /** @type {string | null} */
  let lastTs = null;

  /**
   * @param {string} body
   * @param {string | null} explicitTs
   */
  function handleBody(body, explicitTs) {
    const trimmed = body.trim();
    if (!trimmed) return;

    const ts = explicitTs || lastTs;

    if (isCancelLine(trimmed)) {
      let idx = -1;
      for (let i = accepted.length - 1; i >= 0; i--) {
        if (/magn[eé]sio/i.test(accepted[i].description)) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        accepted.splice(idx, 1);
        cancelledCount += 1;
      } else if (accepted.length > 0) {
        accepted.pop();
        cancelledCount += 1;
      }
      return;
    }

    if (isNoiseMessage(trimmed)) {
      skipped.push({ line: trimmed.slice(0, 200), reason: "noise" });
      return;
    }

    const parsed = parseExpenseLine(trimmed);
    if (!parsed) {
      skipped.push({ line: trimmed.slice(0, 200), reason: "no-expense-pattern" });
      return;
    }

    if (accepted.length >= MAX_PARSED_EXPENSES) {
      skipped.push({ line: trimmed.slice(0, 200), reason: "max-entries-exceeded" });
      return;
    }

    const dateISO = ts
      ? new Date(ts).toISOString()
      : new Date().toISOString();

    accepted.push({
      description: parsed.description,
      amount: parsed.amount,
      dateISO,
    });
  }

  for (const rawLine of lines) {
    let line = String(rawLine).replace(/^\uFEFF/, "");
    line = line.replace(/^[\u200E\u200F]+/, "").trim();
    if (!line) continue;

    const segments = extractWhatsAppSegments(line);
    if (segments.length === 0) {
      handleBody(line, null);
      continue;
    }

    for (const seg of segments) {
      if (seg.dateISO) lastTs = seg.dateISO;
      handleBody(seg.body, seg.dateISO);
    }
  }

  return { entries: accepted, skipped, cancelledCount, error: null };
}

module.exports = {
  parseWhatsAppBulk,
  MAX_BULK_CHARS,
  MAX_PARSED_EXPENSES,
};
