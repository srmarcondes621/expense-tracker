/**
 * Tags derived from expense description (no user-managed tag UI).
 * @param {string} description
 * @returns {string[]}
 */
function deriveExpenseTags(description) {
  if (/simone/i.test(String(description))) {
    return ["Simone"];
  }
  return [];
}

module.exports = { deriveExpenseTags };
