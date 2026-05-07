/**
 * @param {string} line
 * @returns {{ description: string; amount: number } | null}
 */
function parseExpenseLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed) return null;
  const parts = trimmed.split("-");
  if (parts.length < 2) return null;
  const amountStr = parts.pop().trim();
  const description = parts.join("-").trim();
  if (!description) return null;
  const normalized = amountStr.replace(/\s/g, "").replace(",", ".");
  const amount = parseFloat(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { description, amount };
}

module.exports = { parseExpenseLine };
