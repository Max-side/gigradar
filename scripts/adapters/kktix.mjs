import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";

/**
 * KKTIX adapter (SPEC §5, §5.1, §5.2). Two fetch strategies, decided during
 * M2's real endpoint testing:
 *
 * - ORG_PAGE_VENUES: venues that self-promote almost all their own shows and
 *   have one dedicated KKTIX organizer account -> scrape that org's listing
 *   page directly.
 * - SEARCH_VENUES: venues that just rent out space; each show is run by a
 *   different promoter's own org account, so there's no single page to
 *   scrape. Use KKTIX's site-wide search instead and filter results by the
 *   venue field on each event's own detail page (the search itself can
 *   false-positive on unrelated events).
 *
 * Every venue-specific choice here (which orgs, which regexes) is a decision
 * about the *current* real world, not a stable API contract — expect this
 * file to need periodic upkeep as venues start/stop self-promoting.
 */

export const name = "KKTIX";
export const priority = 1;

const UA = "GigRadar/1.0 (personal use, non-commercial; github.com/<you>/gigradar)";
const REQUEST_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 30000; // SPEC §4.3 — every adapter request needs a hard timeout so one slow page can't hang the whole pipeline.

const ORG_PAGE_VENUES = ["thewalllivehouse", "kafka", "pipelivemusic", "emergelivehouse", "emergelivehouse2"];

// Match both the colloquial (台北/台中) and official (臺北/臺中) character
// variants — real Taiwanese address data uses both, and a silent no-match
// here takes the exact same code path as an intentional false-positive drop.
const SEARCH_VENUES = [
  { keyword: "Legacy Taipei", match: (venue, address) => /^Legacy(\s|$)/.test(venue) && /^[台臺]北/.test(address) },
  { keyword: "Legacy Taichung", match: (venue, address) => /^Legacy(\s|$)/.test(venue) && /^[台臺]中/.test(address) },
  { keyword: "Revolver", match: (venue) => /^Revolver/i.test(venue) },
  { keyword: "Clapper Studio", match: (venue) => /^Clapper/i.test(venue) },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // globalThis.fetch, NOT bare fetch(): this module exports its own `fetch`
    // (the adapter interface, SPEC §5), which shadows the global Fetch API
    // everywhere in this file. Calling bare fetch(url, ...) here silently
    // recurses into our own zero-arg adapter fetch() instead of hitting the
    // network — cost a long debugging session to find, don't reintroduce it.
    const res = await globalThis.fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with one retry on timeout/network error (SPEC §4.3). */
async function fetchHtml(url) {
  try {
    return await fetchOnce(url);
  } catch (err) {
    logProgress(`retry: ${url} - ${err.message}`);
    return await fetchOnce(url);
  }
}

async function fetchOrgListing(org) {
  const html = await fetchHtml(`https://${org}.kktix.cc/`);
  const $ = cheerio.load(html);
  const urls = [];
  $(".current-events #event-list li.clearfix h2 a").each((_, el) => {
    const href = $(el).attr("href");
    // Strip query strings like the search path already does (line ~86) — an
    // unstripped tracking param here pollutes raw_id, since fetchEventDetail
    // derives raw_id from the URL's last path segment.
    if (href) urls.push(href.split("?")[0]);
  });
  return urls;
}

async function fetchSearchResultUrls(keyword) {
  const html = await fetchHtml(`https://kktix.com/events?search=${encodeURIComponent(keyword)}`);
  const $ = cheerio.load(html);
  const urls = new Set();
  $('a[href*="/events/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href && !href.includes("kktix.com/dashboard") && !href.endsWith(".ics")) {
      urls.add(href.split("?")[0]);
    }
  });
  return Array.from(urls);
}

/** Scrapes one event's own page — this is the only place price/venue/date are complete. */
async function fetchEventDetail(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title_raw = $(".header-title h1").first().text().trim();
  const infoLis = $(".event-info ul.info li");
  const date_raw = $(infoLis.get(0)).find(".timezoneSuffix").first().text().trim();
  const venue_raw = $(infoLis.get(1)).find(".info-desc").first().text().trim();

  const tickets_raw = [];
  $("table tbody tr").each((_, tr) => {
    const nameCell = $(tr).find("td.name").first().clone();
    nameCell.children().remove();
    const name = nameCell.text().trim();
    const priceText = $(tr).find("td.price .currency-value").first().text().trim();
    const price = priceText ? Number(priceText.replace(/,/g, "")) : null;
    const closed = $(tr).find(".status.closed").length > 0;
    if (name) tickets_raw.push({ name, price, closed });
  });

  const raw_id = url.split("/").filter(Boolean).pop();
  return { raw_id, url, title_raw, date_raw, venue_raw, tickets_raw, source_name: name };
}

export async function fetch() {
  const results = [];
  const warnings = [];

  // Strategy 1: self-promoting venues, one listing page each.
  for (const org of ORG_PAGE_VENUES) {
    await sleep(REQUEST_DELAY_MS);
    logProgress(`fetching org listing: ${org}`);
    let eventUrls = [];
    try {
      eventUrls = await fetchOrgListing(org);
    } catch (err) {
      warnings.push(`org listing failed for ${org}: ${err.message}`);
      continue;
    }
    logProgress(`org ${org}: ${eventUrls.length} upcoming event(s) listed`);
    for (const url of eventUrls) {
      await sleep(REQUEST_DELAY_MS);
      logProgress(`fetching detail: ${url}`);
      try {
        const detail = await fetchEventDetail(url);
        results.push(detail);
        logProgress(`  + ${detail.title_raw}`);
      } catch (err) {
        warnings.push(`event detail failed for ${url}: ${err.message}`);
      }
    }
  }

  // Strategy 2: multi-promoter venues, site-wide search + per-event venue filter.
  for (const { keyword, match } of SEARCH_VENUES) {
    await sleep(REQUEST_DELAY_MS);
    logProgress(`fetching search: ${keyword}`);
    let eventUrls = [];
    try {
      eventUrls = await fetchSearchResultUrls(keyword);
    } catch (err) {
      warnings.push(`search failed for "${keyword}": ${err.message}`);
      continue;
    }
    logProgress(`search "${keyword}": ${eventUrls.length} result(s) to check`);
    for (const url of eventUrls) {
      await sleep(REQUEST_DELAY_MS);
      logProgress(`fetching detail: ${url}`);
      let detail;
      try {
        detail = await fetchEventDetail(url);
      } catch (err) {
        warnings.push(`event detail failed for ${url}: ${err.message}`);
        continue;
      }
      const [venuePart, addressPart = ""] = detail.venue_raw.split("/").map((s) => s.trim());
      if (match(venuePart, addressPart)) {
        results.push(detail);
        logProgress(`  + ${detail.title_raw}`);
      }
      // else: search false-positive (venue name mentioned but not actually the venue) — drop silently.
    }
  }

  if (warnings.length) {
    console.warn(`[kktix] ${warnings.length} sub-request(s) failed:\n` + warnings.join("\n"));
  }

  return results;
}
