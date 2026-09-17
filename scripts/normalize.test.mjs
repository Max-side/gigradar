import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, parseIndievoxDate, parseIndievoxVenue } from "./normalize.mjs";

const artistsYml = [{ canonical: "深海系樂團", aliases: [], tags_origin_default: "本地" }];

function makeRaw(overrides = {}) {
  return {
    raw_id: "a",
    title_raw: "深海系樂團 Live",
    url: "https://example.com/a",
    date_raw: "2026/10/15(周四) 19:30(+0800)",
    venue_raw: "Legacy Taipei / 台北市中正區",
    tickets_raw: [],
    source_name: "KKTIX",
    ...overrides,
  };
}

test("priceFromTickets fix: a closed early-bird tier must not set price_min once a pricier open tier exists", () => {
  const raw = makeRaw({
    tickets_raw: [
      { name: "早鳥", price: 800, closed: true },
      { name: "一般", price: 1200, closed: false },
    ],
  });
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.price_min, 1200, "closed tier's lower price must not leak into price_min");
  assert.equal(event.price_max, 1200);
});

test("priceFromTickets: once EVERY tier is closed, fall back to their prices for reference", () => {
  const raw = makeRaw({
    tickets_raw: [
      { name: "早鳥", price: 800, closed: true },
      { name: "一般", price: 1200, closed: true },
    ],
  });
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.price_min, 800);
  assert.equal(event.price_max, 1200);
});

test("statusFromTickets fix: a same-day show with all tiers closed is 'sold_out', not 'ended'", () => {
  // Reproduces the exact daily-cron condition: event dated "today" (Taiwan
  // calendar), all tiers closed. Before the fix, new Date(eventDate) parsed
  // as UTC midnight compared as already past.
  const taiwanNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayTaiwan = taiwanNow.toISOString().slice(0, 10);
  const [y, m, d] = todayTaiwan.split("-");

  const raw = makeRaw({
    date_raw: `${y}/${m}/${d}(週日) 20:00(+0800)`,
    tickets_raw: [{ name: "一般", price: 800, closed: true }],
  });
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.status, "sold_out");
});

test("statusFromTickets: a clearly past date with closed tiers is 'ended'", () => {
  const raw = makeRaw({
    date_raw: "2020/01/01(週三) 20:00(+0800)",
    tickets_raw: [{ name: "一般", price: 800, closed: true }],
  });
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.status, "ended");
});

test("parseIndievoxDate: prefers the 'start' time over the earlier 'open' (doors) time", () => {
  const result = parseIndievoxDate("2026.09.19 (Sat.) 19:30 open / 20:00 start");
  assert.deepEqual(result, { date: "2026-09-19", time: "20:00" });
});

test("parseIndievoxDate: falls back to whatever single time is present when there's no open/start pair", () => {
  const result = parseIndievoxDate("2026.10.05 (Mon.) 21:00");
  assert.deepEqual(result, { date: "2026-10-05", time: "21:00" });
});

test("parseIndievoxDate: falls back to the listing page's dateless format with time: null", () => {
  const result = parseIndievoxDate("2026/09/18 (五)");
  assert.deepEqual(result, { date: "2026-09-18", time: null });
});

test("parseIndievoxDate: handles spaced slashes ('2026 / 10 / 2')", () => {
  const result = parseIndievoxDate("2026 / 10 / 2（五）");
  assert.equal(result.date, "2026-10-02");
});

test("parseIndievoxDate: handles Chinese-unit dates ('2026年10月3日')", () => {
  const result = parseIndievoxDate("2026年10月3日 (Sat/六)");
  assert.equal(result.date, "2026-10-03");
});

test("parseIndievoxVenue: splits 'VENUE（address）' and derives city from the address", () => {
  const result = parseIndievoxVenue("WESTAR（台北市萬華區西門里漢中街116號8樓）", []);
  assert.deepEqual(result, { venue: "WESTAR", city: "台北" });
});

test("parseIndievoxVenue: a bare venue name with no address falls back to venues.yml", () => {
  const venuesYml = [{ match: "野地方", city: "台北" }];
  const result = parseIndievoxVenue("野地方 Wildlab", venuesYml);
  assert.deepEqual(result, { venue: "野地方 Wildlab", city: "台北" });
});

test("parseIndievoxVenue: an unmapped bare venue name gets city: null, not a thrown error", () => {
  const result = parseIndievoxVenue("某個沒收錄過的展演空間", []);
  assert.deepEqual(result, { venue: "某個沒收錄過的展演空間", city: null });
});

test("normalize() end-to-end for an iNDIEVOX raw event", () => {
  const raw = {
    raw_id: "26_iv04098fa",
    title_raw: "深海系樂團 Live",
    url: "https://www.indievox.com/activity/detail/26_iv04098fa",
    date_raw: "2026.09.19 (Sat.) 19:30 open / 20:00 start",
    venue_raw: "野地方 Wildlab",
    tickets_raw: [],
    source_name: "iNDIEVOX",
  };
  const venuesYml = [{ match: "野地方", city: "台北" }];
  const { event } = normalize(raw, artistsYml, venuesYml);
  assert.equal(event.date, "2026-09-19");
  assert.equal(event.time, "20:00");
  assert.equal(event.venue, "野地方 Wildlab");
  assert.equal(event.city, "台北");
});
