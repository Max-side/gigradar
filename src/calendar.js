/** Pure month-grid math for favorites.html's calendar view — no DOM here, see app.js for wiring. */

/**
 * @param {number} year
 * @param {number} month - 1-12
 * @returns {(({day: number, date: string} | null)[])[]} weeks, each 7 cells; null = padding outside the month
 */
export function buildMonthGrid(year, month) {
  const startWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** (year, month) -> (year, month) one step forward/back, wrapping across year boundaries. */
export function addMonths(year, month, delta) {
  const total = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
