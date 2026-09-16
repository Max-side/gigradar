/**
 * Pure decision logic for building a sources.json entry after one adapter run
 * (FR-13/14, AC-11/AC-14, SPEC §4.2 steps 3-4). Split out from fetch.mjs so
 * the failure/anomaly rules — the part most likely to regress silently —
 * have direct unit test coverage instead of only being exercised end-to-end.
 */

/**
 * @param {string} name
 * @param {{ error: string|null, rawCount: number }} run
 * @param {{ last_success: string|null, last_count: number }|undefined} previous
 * @returns {{
 *   entry: { name: string, last_success: string|null, last_error: string|null, last_count: number, status: "ok"|"error"|"anomaly" },
 *   anomaly: { reason: "error"|"anomaly", detail: string, lastCount: number }|null
 * }}
 */
export function classifySourceRun(name, { error, rawCount }, previous) {
  const previousCount = previous?.last_count ?? 0;

  if (error) {
    // AC-11: a failed run must NOT overwrite last_success/last_count — those
    // should keep reflecting the last time this source actually worked.
    return {
      entry: { name, last_success: previous?.last_success ?? null, last_error: error, last_count: previousCount, status: "error" },
      anomaly: { reason: "error", detail: error, lastCount: previousCount },
    };
  }

  // FR-14/AC-14/R1: 0 results right after a previous run had some is the
  // classic "site changed HTML, parser now silently matches nothing" failure
  // — worth flagging even though fetch() didn't throw.
  if (rawCount === 0 && previousCount > 0) {
    return {
      entry: {
        name,
        last_success: new Date().toISOString(),
        last_error: null,
        // Keep last_count at the old value (not 0) so this keeps reading as
        // anomalous every day the source stays broken, instead of "healing"
        // itself the moment today's 0 becomes tomorrow's baseline.
        last_count: previousCount,
        status: "anomaly",
      },
      anomaly: { reason: "anomaly", detail: `抓到 0 筆，上次成功 ${previousCount} 筆`, lastCount: previousCount },
    };
  }

  return {
    entry: { name, last_success: new Date().toISOString(), last_error: null, last_count: rawCount, status: "ok" },
    anomaly: null,
  };
}
