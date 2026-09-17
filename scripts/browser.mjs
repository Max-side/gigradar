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
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: UA, locale: "zh-TW" });
    return await fn(page);
  } finally {
    await browser.close();
  }
}
