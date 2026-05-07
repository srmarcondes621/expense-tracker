/**
 * Billing cycle: 10th → 9th next month. cycleKey = YYYY-MM of cycle start month.
 * @param {Date} date
 * @returns {string}
 */
function getCycleKey(date) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  let y = d.getFullYear();
  let m = d.getMonth();
  if (day < 10) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

module.exports = { getCycleKey };
