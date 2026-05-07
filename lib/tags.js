/**
 * Tags derived from expense description (no user-managed tag UI).
 * @param {string} description
 * @returns {string[]}
 */
function deriveExpenseTags(description) {
  const text = String(description || "");
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const tags = [];

  if (normalized.includes("simone")) {
    tags.push("Simone");
  }

  if (/cartao\s+sergio/.test(normalized)) {
    tags.push("Cartao Sergio");
  }

  return tags;
}

module.exports = { deriveExpenseTags };
