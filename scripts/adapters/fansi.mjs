import { withPage } from "../browser.mjs";
import { logProgress } from "../progress-log.mjs";

/**
 * FANSI GO (go.fansi.me) adapter. Added 2026-09-17. Needs a real browser
 * (Playwright), not plain fetch — this is a client-rendered Next.js app with
 * zero event data in the initial server-rendered HTML (confirmed: a plain
 * fetch of /allevents returns 200 with no "Just a moment" Cloudflare
 * challenge, but also no event links at all — the events only exist after
 * JS runs).
 *
 * /allevents lists every currently-selling event on one page, no pagination
 * (confirmed by scrolling to the bottom and re-counting: same 26 cards).
 *
 * No structured venue field anywhere, including on each event's own detail
 * page — those are decorative poster-style text (fullwidth/stylized
 * characters, no consistent "地點｜X" pattern like iNDIEVOX has) with no
 * reliable place to extract a real venue name from. The listing card's own
 * "organizer" field is the best signal available and is often the actual
 * venue (e.g. "百樂門酒館", "PIPE Live Music") but sometimes a label/promoter
 * name instead (e.g. "Wrong Game Records") — used as-is for `venue`, same
 * "good enough for coverage, not always precise" tradeoff as tixcraft's
 * untracked venues. City comes from data/venues.yml the same way.
 */

export const name = "FANSI GO";
export const priority = 4;

const LIST_URL = "https://go.fansi.me/allevents";

/** "2026/09/19" -> unchanged; normalize.mjs's parseFansiDate expects exactly this shape. No time — the detail page has one, but only as unreliable decorative text, so it's skipped (same tradeoff tixcraft made for price, D16). */
async function fetchCards(page) {
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  try {
    await page.waitForSelector("a[href^='/events/'] h3", { timeout: 15000 });
  } catch {
    return []; // page loaded but no events rendered in time — treat as 0 results, not a crash
  }
  await page.waitForTimeout(1500); // let the rest of the React tree settle

  return page.$$eval("a[href^='/events/']", (els) =>
    els
      .map((a) => {
        const h3 = a.querySelector("h3");
        if (!h3) return null;
        const statusEl = a.querySelector("header p");
        const orgEl = a.querySelector(".card-body p");
        const timeEl = a.querySelector("time");
        return {
          url: a.href,
          title: h3.textContent.trim(),
          organizer: orgEl ? orgEl.textContent.trim() : "",
          status: statusEl ? statusEl.textContent.trim() : "",
          date_raw: timeEl ? (timeEl.getAttribute("datetime") ?? timeEl.textContent.trim()) : "",
        };
      })
      .filter(Boolean)
  );
}

export async function fetch() {
  logProgress("fetching FANSI GO /allevents");
  let cards;
  try {
    cards = await withPage(fetchCards);
  } catch (err) {
    logProgress(`FANSI GO fetch failed: ${err.stack}`);
    throw err;
  }

  const results = cards
    .filter((c) => c.status !== "周邊販售" && c.date_raw) // merch-only listings (if any) aren't real performances
    .map((c) => ({
      raw_id: c.url.split("/").filter(Boolean).pop(),
      url: c.url,
      title_raw: c.title,
      date_raw: c.date_raw,
      venue_raw: c.organizer,
      tickets_raw: [],
      source_name: name,
    }));

  logProgress(`FANSI GO: ${results.length} event(s) fetched`);
  return results;
}
