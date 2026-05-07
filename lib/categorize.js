function normalizeForMatch(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * @param {string} description
 * @param {{ categories?: { name: string; keywords: string[] }[]; fallbackCategory?: string }} config
 * @returns {string}
 */
function categorize(description, config) {
  const norm = normalizeForMatch(description);
  const list = config.categories || [];
  const fallback = config.fallbackCategory || "Outros";
  for (const cat of list) {
    const name = cat.name;
    if (!cat.keywords || !cat.keywords.length) continue;
    for (const kw of cat.keywords) {
      if (norm.includes(normalizeForMatch(kw))) return name;
    }
  }
  return fallback;
}

module.exports = { categorize };
