import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as kktix from "./adapters/kktix.mjs";
import * as tixcraft from "./adapters/tixcraft.mjs";
import * as manual from "./adapters/manual.mjs";
import { loadArtists, loadVenues, normalize } from "./normalize.mjs";
import { dedupe } from "./dedup.mjs";
import { resetProgressLog, logProgress } from "./progress-log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const adapters = [kktix, tixcraft, manual];

/**
 * M2 scope: get KKTIX flowing end-to-end (fetch -> normalize -> dedupe -> write).
 * Known gap vs. full SPEC §4.2: on a source failure this does NOT yet fall back
 * to that source's previous events.json entries (AC-11) — it just records the
 * error in sources.json. Wiring that in is M3/M6 work, once diff.mjs exists to
 * compare against the previous commit.
 */
async function main() {
  resetProgressLog();
  const artistsYml = loadArtists();
  const venuesYml = loadVenues();
  const sourcesStatus = [];
  const normalizedEvents = [];
  const needsReview = [];

  for (const adapter of adapters) {
    logProgress(`=== starting adapter: ${adapter.name} ===`);
    let rawEvents = [];
    let error = null;
    try {
      rawEvents = await adapter.fetch();
    } catch (err) {
      error = err.message;
      logProgress(`${adapter.name} fetch() threw: ${err.stack}`);
    }
    logProgress(`=== finished adapter: ${adapter.name}, ${rawEvents.length} raw event(s) ===`);

    sourcesStatus.push({
      name: adapter.name,
      last_success: error ? null : new Date().toISOString(),
      last_error: error,
      last_count: rawEvents.length,
      status: error ? "error" : "ok",
    });

    for (const raw of rawEvents) {
      const result = normalize(raw, artistsYml, venuesYml);
      if (result.event) {
        normalizedEvents.push(result.event);
      } else {
        needsReview.push(result.needsReview);
      }
    }
  }

  const deduped = dedupe(normalizedEvents);

  writeFileSync(
    path.join(DATA_DIR, "events.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), events: deduped }, null, 2) + "\n"
  );
  writeFileSync(
    path.join(DATA_DIR, "needs-review.json"),
    JSON.stringify({ items: needsReview }, null, 2) + "\n"
  );
  writeFileSync(
    path.join(DATA_DIR, "sources.json"),
    JSON.stringify({ sources: sourcesStatus }, null, 2) + "\n"
  );

  console.log(
    `GigRadar fetch complete: ${deduped.length} recognized event(s), ${needsReview.length} needing review.`
  );
}

main();
