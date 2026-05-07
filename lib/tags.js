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

  if (
    /\bcartao(\s+sergio)?\b/.test(normalized) ||
    /\b(vivo|fralda|cetaphil|almoco|jantar|uber|show|whey|wey|remedio|remedios)\b/.test(normalized)
  ) {
    tags.push("Cartao Sergio");
  }

  if (
    /\b(conta|santander|condominio|neguinha|guardioes?|prevent|congas|agua|luz)\b/.test(
      normalized
    )
  ) {
    tags.push("Santander");
  }

  return tags;
}

module.exports = { deriveExpenseTags };
