import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";

/**
 * 拓元 tixcraft adapter (SPEC §5.3). Listing page only — the detail pages
 * (where price lives) sit behind a JS-challenge anti-bot wall that a plain
 * fetch() can't pass (real browser test showed content, but that's out of
 * budget for a GitHub Actions job — see SPEC D16). So every event from this
 * source has price_min/max = null and status = "announced"; the ticket_url
 * still takes the user straight to the real page to check.
 */

export const name = "拓元";
export const priority = 2;

// tixcraft's WAF blocks requests without a convincing browser User-Agent —
// bare curl/node fetch UAs get an instant {"response":"block"} 403.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 30000;

async function fetchOnce(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // globalThis.fetch, not bare fetch — see the identical warning in kktix.mjs;
    // this file's own exported `fetch` shadows the global one the same way.
    const res = await globalThis.fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "zh-TW,zh;q=0.9",
        Referer: referer,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url, referer) {
  try {
    return await fetchOnce(url, referer);
  } catch (err) {
    logProgress(`tixcraft retry: ${url} - ${err.message}`);
    return await fetchOnce(url, referer);
  }
}

export async function fetch() {
  logProgress("fetching tixcraft activity listing");
  const html = await fetchHtml("https://tixcraft.com/activity", "https://tixcraft.com/");
  const $ = cheerio.load(html);

  const seen = new Set();
  const results = [];

  $("#all .eventbl .row.align-items-center").each((_, el) => {
    const row = $(el);
    if (row.find(".date").length === 0) return;

    const link = row.find(".text-bold a").first();
    const href = link.attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);

    const title_raw = link.text().trim();
    const date_raw = row.find(".date").first().text().trim();
    const venue_raw = row.find(".text-small.text-med-light").first().text().trim();
    const url = href.startsWith("http") ? href : `https://tixcraft.com${href}`;
    const raw_id = href.split("/").filter(Boolean).pop();

    results.push({ raw_id, url, title_raw, date_raw, venue_raw, tickets_raw: [], source_name: name });
  });

  logProgress(`tixcraft: ${results.length} unique upcoming event(s) listed`);
  return results;
}
