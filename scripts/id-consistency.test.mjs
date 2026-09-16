import { test } from "node:test";
import assert from "node:assert/strict";
import { computeId, dedupe } from "./dedup.mjs";
import { computeEventId, computePossibleEventIds } from "../src/id.js";

// Node has Web Crypto globally (crypto.subtle) since v19, so src/id.js's
// browser implementation runs here unmodified — this proves both hashing
// paths agree, which is the entire point of SPEC §7's manual-event dedup.
const cases = [
  ["深海系樂團", "2026-10-15", "Legacy Taipei"],
  ["ABC Band", "2026-10-18", "海邊的卡夫卡"],
  [" abc band ", "2026-10-18", "  海邊的卡夫卡 "], // whitespace/case should still normalize the same
];

for (const [headliner, date, venue] of cases) {
  test(`computeId and computeEventId agree for ${headliner}/${date}/${venue}`, async () => {
    const nodeId = computeId(headliner, date, venue);
    const browserId = await computeEventId(headliner, date, venue);
    assert.equal(browserId, nodeId);
  });
}

function makeEvent(overrides = {}) {
  return {
    title_raw: "Test Event",
    headliners: ["深海系樂團"],
    lineup: ["深海系樂團"],
    is_festival: false,
    venue: "Legacy Taipei",
    city: "台北",
    date: "2026-10-15",
    time: "19:30",
    on_sale_at: null,
    price_min: 800,
    price_max: 800,
    status: "on_sale",
    tags_type: ["專場"],
    tags_origin: ["本地"],
    ticket_url: "https://example.com/a",
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
    first_seen_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("AC-17 fix: a manual event's possible ids cover dedup.mjs's real matinee/evening split", async () => {
  // Same setup as dedup.test.mjs's matinee/evening case — deliberately kept
  // in sync with it rather than importing, since this test's whole point is
  // to catch drift between dedup.mjs's real bucket rule and id.js's mirror.
  const matinee = makeEvent({ time: "14:00", sources: [{ name: "KKTIX", url: "x", raw_id: "matinee" }] });
  const evening = makeEvent({ time: "20:00", sources: [{ name: "KKTIX", url: "x", raw_id: "evening" }] });
  const realResults = dedupe([matinee, evening]);
  assert.equal(realResults.length, 2, "sanity check: dedup.mjs must actually split these into two events");
  const realIds = new Set(realResults.map((e) => e.id));

  // A user manually adds ONLY the matinee show, before either is scraped.
  const manualPossibleIds = await computePossibleEventIds("深海系樂團", "2026-10-15", "Legacy Taipei", "14:00");

  assert.ok(
    manualPossibleIds.some((id) => realIds.has(id)),
    "the manual event's possible ids must include whichever real id the matinee show actually gets once split"
  );
});
