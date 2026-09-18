import { logProgress } from "../progress-log.mjs";

/**
 * Ticket Plus (ticketplus.com.tw, "遠大售票系統") adapter. Added 2026-09-17.
 *
 * By far the cleanest of the five sources: it's a Vue SPA with genuinely no
 * server-rendered HTML at all (a plain fetch of the homepage gets an ~6KB
 * empty shell), but everything it renders comes from a public, unauthenticated
 * JSON API — `apis.ticketplus.com.tw/config/api/v1/getS3?path=...` — that a
 * plain fetch() can call directly. No Cloudflare, no client-side-only data,
 * no freeform-text venue parsing like iNDIEVOX/FANSI GO needed: `sessions.json`
 * has structured `date`/`time`/`location`/`address` fields per session.
 *
 * Three-step fetch: `main/mainEvents.json` lists every currently active
 * event's id (confirmed: `allEventId.length` exactly matches the number of
 * entries in `allEventMainPageInfo` — this is genuinely the full catalog, not
 * just a homepage teaser); `event/{id}/sessions.json` gives each event's
 * individual show dates. A single event can have multiple sessions (e.g. a
 * 2-city tour with different dates/venues per session, or a Taipei run with
 * a matinee and an evening show) — each session becomes its own RawEvent,
 * same as one KKTIX/tixcraft listing row each.
 *
 * Price is the one field NOT in sessions.json's structured data — like
 * tixcraft/iNDIEVOX/FANSI GO it only exists as prose, in `event/{id}/event.json`'s
 * `info` field (the "活動介紹" tab's raw HTML, found 2026-09-18). Fetched once
 * per eventId, not once per session, since normalize.mjs's parsePriceFromText
 * does the actual number extraction from that HTML.
 */

export const name = "Ticket Plus";
export const priority = 5;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const API_BASE = "https://apis.ticketplus.com.tw/config/api/v1/getS3";
const REQUEST_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonOnce(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(`${API_BASE}?path=${encodeURIComponent(path)}`, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(path) {
  try {
    return await fetchJsonOnce(path);
  } catch (err) {
    logProgress(`ticketplus retry: ${path} - ${err.message}`);
    return await fetchJsonOnce(path);
  }
}

export async function fetch() {
  logProgress("fetching Ticket Plus main event list");
  const main = await fetchJson("main/mainEvents.json");
  const eventIds = main.allEventId ?? [];
  logProgress(`Ticket Plus: ${eventIds.length} event(s) listed`);

  const results = [];
  for (const eventId of eventIds) {
    await sleep(REQUEST_DELAY_MS);
    let sessionsData;
    try {
      sessionsData = await fetchJson(`event/${eventId}/sessions.json`);
    } catch (err) {
      logProgress(`ticketplus sessions fetch failed for ${eventId}: ${err.message}`);
      continue;
    }

    // Price lives in this event's own freeform "活動介紹" (info) field, not
    // in sessions.json (structured but has no price field at all) — fetched
    // once per eventId, not once per session, since price is one value for
    // the whole event, not per session/city (2026-09-18). A failure here
    // isn't fatal to the event itself, just leaves its price unparsed.
    //
    // No separate sleep before this one: it piggybacks on the same eventId
    // iteration as sessions.json above, right after it — a real measured run
    // of a second REQUEST_DELAY_MS here doubled Ticket Plus's own total fetch
    // time (~3min to ~6min out of ~14min for the whole pipeline) for very
    // little politeness benefit over a same-eventId back-to-back pair; the
    // 2s gap BETWEEN different eventIds (the sleep above) is what actually
    // paces the request rate against the server.
    let priceTextRaw = "";
    try {
      const eventData = await fetchJson(`event/${eventId}/event.json`);
      priceTextRaw = eventData.info ?? "";
    } catch (err) {
      logProgress(`ticketplus event.json fetch failed for ${eventId}: ${err.message}`);
    }

    for (const session of sessionsData.sessions ?? []) {
      if (session.hidden) continue; // withdrawn/not-yet-on-sale session, same spirit as KKTIX skipping non-listed events
      if (session.name?.includes("周邊商品")) continue; // merch pre-order listing, not a real performance (same filter FANSI GO needs)
      results.push({
        raw_id: `${eventId}_${session.sessionId}`,
        url: `https://ticketplus.com.tw/activity/${eventId}`,
        title_raw: session.name,
        // "location / address" mirrors KKTIX's venue_raw shape exactly, so
        // normalize.mjs reuses parseKktixVenue for this source too.
        venue_raw: `${session.location ?? ""} / ${session.address ?? ""}`,
        // date+time concatenated into one string for parseTicketPlusDate to
        // split — RawEvent only has a single date_raw field.
        date_raw: `${session.date ?? ""} ${session.time ?? ""}`,
        tickets_raw: [],
        price_text_raw: priceTextRaw,
        source_name: name,
      });
    }
  }

  logProgress(`Ticket Plus: ${results.length} session(s) fetched`);
  return results;
}
