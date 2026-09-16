import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as kktix from "./adapters/kktix.mjs";
import * as tixcraft from "./adapters/tixcraft.mjs";
import * as manual from "./adapters/manual.mjs";
import { loadArtists, loadVenues, normalize } from "./normalize.mjs";
import { dedupe } from "./dedup.mjs";
import { diff } from "./diff.mjs";
import { resetProgressLog, logProgress } from "./progress-log.mjs";
import { notifySourceAnomaly } from "./notify.mjs";
import { classifySourceRun } from "./source-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const adapters = [kktix, tixcraft, manual];

function loadPreviousEvents() {
  try {
    const raw = readFileSync(path.join(DATA_DIR, "events.json"), "utf-8");
    return JSON.parse(raw).events ?? [];
  } catch {
    return []; // first run ever, or the file is missing/corrupt — treat everything as new.
  }
}

function loadPreviousSources() {
  try {
    const raw = readFileSync(path.join(DATA_DIR, "sources.json"), "utf-8");
    return JSON.parse(raw).sources ?? [];
  } catch {
    return [];
  }
}

/**
 * Known gap vs. full SPEC §4.2: on a source failure this does NOT yet fall back
 * to that source's previous events.json entries (AC-11) — it just records the
 * error in sources.json. That's still open (tracked past M6 now).
 */
async function main() {
  resetProgressLog();
  const artistsYml = loadArtists();
  const venuesYml = loadVenues();
  const previousEvents = loadPreviousEvents();
  const previousSources = loadPreviousSources();
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

    const previous = previousSources.find((s) => s.name === adapter.name);
    const { entry, anomaly } = classifySourceRun(adapter.name, { error, rawCount: rawEvents.length }, previous);
    sourcesStatus.push(entry);

    if (anomaly) {
      try {
        await notifySourceAnomaly({ name: adapter.name, ...anomaly });
      } catch (err) {
        logProgress(`notifySourceAnomaly failed for ${adapter.name}: ${err.stack}`);
      }
    }

    for (const raw of rawEvents) {
      // A single malformed record must never take down the whole run — every
      // other successfully-scraped event (and this run's writes) would be
      // lost with it (found in review: this loop had no isolation at all).
      try {
        const result = normalize(raw, artistsYml, venuesYml);
        if (result.event) {
          normalizedEvents.push(result.event);
        } else {
          needsReview.push(result.needsReview);
        }
      } catch (err) {
        logProgress(`normalize() threw for raw_id=${raw.raw_id}: ${err.stack}`);
        needsReview.push({
          raw_id: raw.raw_id,
          title_raw: raw.title_raw ?? null,
          url: raw.url ?? null,
          source: raw.source_name,
          reason: "normalize_error",
          detail: err.message,
        });
      }
    }
  }

  const deduped = dedupe(normalizedEvents);
  const { events, digest } = diff(previousEvents, deduped);

  writeFileSync(
    path.join(DATA_DIR, "events.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), events }, null, 2) + "\n"
  );
  writeFileSync(path.join(DATA_DIR, "digest.json"), JSON.stringify(digest, null, 2) + "\n");
  writeFileSync(
    path.join(DATA_DIR, "needs-review.json"),
    JSON.stringify({ items: needsReview }, null, 2) + "\n"
  );
  writeFileSync(
    path.join(DATA_DIR, "sources.json"),
    JSON.stringify({ sources: sourcesStatus }, null, 2) + "\n"
  );

  console.log(
    `GigRadar fetch complete: ${events.length} recognized event(s) (${digest.added_ids.length} new, ${digest.updated.length} updated), ${needsReview.length} needing review.`
  );
}

main();
