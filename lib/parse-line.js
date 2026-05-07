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

module.exports = { parseExpenseLine };
