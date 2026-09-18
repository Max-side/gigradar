import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Shared Playwright launch/close boilerplate for adapters that need a real
 * browser instead of plain fetch() — either because the site is protected by
 * a Cloudflare JS challenge (KKTIX's search endpoint) or renders content
 * client-side after load (FANSI GO, a Next.js app with no server-rendered
 * event data at all). Added 2026-09-17 alongside those two adapters.
 *
 * @param {(page: import("playwright").Page) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withPage(fn) {
  return withBrowser(async (browser) => fn(await newPage(browser)));
}

/**
 * Launches one browser for the CALLER to open multiple pages against, e.g.
 * one per event when scraping detail pages for price text (tixcraft, FANSI
 * GO, added 2026-09-18). Launching a fresh browser per event the way
 * `withPage` does is fine for a handful of calls (4 KKTIX search keywords,
 * 1 FANSI GO listing page) but far too slow once "per event" means 80-140
 * events — reusing one browser process and opening a new tab per event cuts
 * that overhead down to just the page navigations themselves.
 * @param {(browser: import("playwright").Browser) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** New tab in an existing browser (see withBrowser) — same UA/locale withPage uses. */
export async function newPage(browser) {
  return browser.newPage({ userAgent: UA, locale: "zh-TW" });
}
