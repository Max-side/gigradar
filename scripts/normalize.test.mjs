import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, parseIndievoxDate, parseIndievoxVenue, parseTicketPlusDate, parseKktixVenue, loadArtists, matchArtists } from "./normalize.mjs";

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

test("parseKktixVenue: recognizes the traditional-character city variants (臺北/臺中/臺南/臺東), not just the common form", () => {
  // Found via a real Ticket Plus run: its address field consistently uses
  // "臺北市"/"臺中市"/"臺南市", not "台北市" — a plain CITY_NAMES.find(startsWith)
  // silently produced city: null for ~40% of promoted events until this was
  // caught. Must still output the common form so the rest of the app only
  // ever sees one spelling.
  assert.equal(parseKktixVenue("臺北大巨蛋 / 臺北市信義區忠孝東路四段515號").city, "台北");
  assert.equal(parseKktixVenue("Legacy Taichung / 臺中市西屯區安和路117號").city, "台中");
  assert.equal(parseKktixVenue("大臺南會展中心 / 臺南市歸仁區歸仁十二路3號").city, "台南");
  assert.equal(parseKktixVenue("The Wall / 台北市文山區羅斯福路四段200號").city, "台北", "common form must still work");
});

test("parseTicketPlusDate: extracts the start date/time from concatenated range strings", () => {
  const result = parseTicketPlusDate("2027-01-09 ~ 2027-01-09 18:00 ~ 18:00");
  assert.deepEqual(result, { date: "2027-01-09", time: "18:00" });
});

test("normalize() end-to-end for a Ticket Plus raw event (reuses parseKktixVenue — same 'location / address' shape)", () => {
  const raw = {
    raw_id: "abc_session1",
    title_raw: "深海系樂團 Live",
    url: "https://ticketplus.com.tw/activity/abc",
    date_raw: "2026-10-15 ~ 2026-10-15 19:30 ~ 19:30",
    venue_raw: "漢神洲際 8樓天際營地 / 台中市北屯區仁美里崇德路三段865號8F",
    tickets_raw: [],
    source_name: "Ticket Plus",
  };
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.date, "2026-10-15");
  assert.equal(event.time, "19:30");
  assert.equal(event.venue, "漢神洲際 8樓天際營地");
  assert.equal(event.city, "台中");
});

test("normalize() end-to-end for a FANSI GO raw event (reuses tixcraft's date/venue parsers — same bare-name-no-address shape)", () => {
  const raw = {
    raw_id: "100130",
    title_raw: "深海系樂團 Live",
    url: "https://go.fansi.me/events/100130",
    date_raw: "2026/09/19",
    venue_raw: "PIPE Live Music",
    tickets_raw: [],
    source_name: "FANSI GO",
  };
  const venuesYml = [{ match: "PIPE", city: "台北" }];
  const { event } = normalize(raw, artistsYml, venuesYml);
  assert.equal(event.date, "2026-09-19");
  assert.equal(event.time, null);
  assert.equal(event.venue, "PIPE Live Music");
  assert.equal(event.city, "台北");
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

test("matchArtists: headliners are ordered by position in the title, not by artists.yml file order", () => {
  const yml = [
    { canonical: "第二順位", aliases: [], tags_origin_default: "本地" },
    { canonical: "第一順位", aliases: [], tags_origin_default: "歐美" },
  ];
  // "第二順位" is declared first in yml, but "第一順位" appears earlier in the title.
  const headliners = matchArtists("第一順位 x 第二順位 聯合演出", yml);
  assert.deepEqual(headliners, ["第一順位", "第二順位"]);
});

test("normalize(): tags_origin is the union of ALL recognized headliners' origins, not just the first", () => {
  const yml = [
    { canonical: "甲團", aliases: [], tags_origin_default: "本地" },
    { canonical: "乙團", aliases: [], tags_origin_default: "歐美" },
  ];
  const raw = makeRaw({ title_raw: "甲團 x 乙團 聯合演出" });
  const { event } = normalize(raw, yml, []);
  assert.deepEqual(event.tags_origin, ["本地", "歐美"]);
});

test("matchArtists: a pure-Latin canonical requires a word boundary, not a bare substring match", () => {
  const yml = [{ canonical: "FLOW", aliases: [], tags_origin_default: "日韓" }];
  // Real bug found live in production data (2026-09-17): FLOW (a real J-rock
  // band) matched inside LE SSERAFIM's unrelated "PUREFLOW" tour name.
  assert.deepEqual(matchArtists("2026 LE SSERAFIM TOUR 'PUREFLOW' IN TAIPEI", yml), []);
  assert.deepEqual(matchArtists('FLOW WORLD TOUR 2026 "NARUTO THE ROCK" Live in Taipei', yml), ["FLOW"]);
});

test("matchArtists: word-boundary check does not affect CJK/mixed-script names, which still match as plain substrings", () => {
  const yml = [{ canonical: "小球", aliases: [], tags_origin_default: "本地" }];
  assert.deepEqual(matchArtists("莊鵑瑛（小球）Live in 台北", yml), ["小球"]);
});

test("artists.yml has no case-insensitive substring collisions between any two canonical/alias names", () => {
  // Regression guard for the real "IVE"/"LIVE" and "ASCA"/"Patrick Brasca"
  // bugs found in review (2026-09-17): a short or common canonical/alias name
  // that is a substring of another entry's name causes matchArtists() to
  // silently over-match. This is a hard failure, not a warning — 0 such
  // collisions currently exist in the live data, so any future addition that
  // creates one should be caught here before it ships.
  const artistsYml = loadArtists();
  const names = [];
  for (const entry of artistsYml) {
    for (const n of [entry.canonical, ...(entry.aliases ?? [])]) {
      names.push({ canonical: entry.canonical, name: n, lower: n.toLowerCase() });
    }
  }
  const collisions = [];
  for (const a of names) {
    for (const b of names) {
      if (a.canonical === b.canonical) continue;
      if (a.name === b.name) continue;
      if (b.lower.includes(a.lower)) {
        collisions.push(`"${a.name}" (${a.canonical}) is a substring of "${b.name}" (${b.canonical})`);
      }
    }
  }
  assert.deepEqual(collisions, []);
});
