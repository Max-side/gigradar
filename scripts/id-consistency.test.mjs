import { test } from "node:test";
import assert from "node:assert/strict";
import { computeId } from "./dedup.mjs";
import { computeEventId } from "../src/id.js";

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
