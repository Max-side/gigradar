/** Formatting helpers shared by all pages. Pure functions, no DOM access. */

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "2026-10-15" -> { day: "15", weekday: "THU", month: "10月15日" } */
export function splitDate(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  return {
    day: String(d.getDate()).padStart(2, "0"),
    weekday: WEEKDAYS[d.getDay()],
    groupLabel: `${d.getMonth() + 1}月${d.getDate()}日`,
  };
}

/** Days from today to the given date, floor'd; negative if in the past. */
export function daysUntil(isoDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

export function formatPrice(min, max) {
  if (min == null) return "票價未公布";
  return `NT$${min.toLocaleString()} up`;
}

/** Whole days elapsed since an ISO datetime (e.g. Event.first_seen_at). */
export function daysSince(isoDateTime) {
  const then = new Date(isoDateTime);
  const now = new Date();
  return Math.floor((now - then) / 86400000);
}

/** e.g. "3 天後" for an on_sale_at datetime; null if already on sale / unknown. */
export function formatOnSaleCountdown(onSaleAtIso) {
  if (!onSaleAtIso) return null;
  const days = daysUntil(onSaleAtIso.slice(0, 10));
  if (days <= 0) return null;
  return `${days} 天後`;
}
