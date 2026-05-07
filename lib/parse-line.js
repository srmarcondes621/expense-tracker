/**
 * @param {string} line
 * @returns {{ description: string; amount: number } | null}
 */
function parseExpenseLine(line) {
  const trimmed = String(line).trim();
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

/**
 * Fallback parser for lines that include explicit BRL prefix, e.g.:
 * "R$ 143,98 cartao sergio"
 * @param {string} line
 * @returns {{ description: string; amount: number } | null}
 */
function parseExpenseLineWithCurrencyPrefix(line) {
  const trimmed = String(line).trim();
  const m = trimmed.match(/R\$\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (!m) return null;
  const amount = parseFloat(String(m[1]).replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;

  const start = m.index != null ? m.index : 0;
  const end = start + m[0].length;
  const description = `${trimmed.slice(0, start)} ${trimmed.slice(end)}`
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:]+|[\s\-:]+$/g, "")
    .trim();
  if (!description) return null;

  return { description, amount };
}

/**
 * @param {string} line
 * @returns {{ description: string; amount: number } | null}
 */
function parseExpenseLineSmart(line) {
  return parseExpenseLine(line) || parseExpenseLineWithCurrencyPrefix(line);
}

module.exports = { parseExpenseLine: parseExpenseLineSmart };
