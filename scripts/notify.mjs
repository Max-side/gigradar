/**
 * Opens a GitHub issue when a source returns 0 events after previously
 * returning >0 (SPEC §4.2 step 4, AC-14). Not implemented yet — M10.
 * Uses the workflow's built-in GITHUB_TOKEN — no extra secret needed.
 */

export async function notifySourceFailure(_sourceName, _previousCount) {
  throw new Error("notifySourceFailure: not implemented until M10");
}
