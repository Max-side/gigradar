/**
 * "manual" pseudo-source (SPEC §5, §7). Per decision S1, manually-added events
 * live only in the user's own Gist/localStorage, not in this repo — so this
 * adapter intentionally always returns []. It exists to keep the adapter list
 * in fetch.mjs uniform and to document the decision at the point someone
 * might expect a data/manual-events.json to read from.
 */

export const name = "manual";
export const priority = 3;

export async function fetch() {
  return [];
}
