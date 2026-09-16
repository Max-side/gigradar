import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./normalize.mjs";

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
