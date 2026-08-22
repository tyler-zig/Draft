/**
 * Players one source calls by a nickname and another by their legal name.
 *
 * Normalization cannot derive these: "Bam" and "Zonovan" share no letters. The
 * only fix is a list, so this is a list -- kept small and evidence-backed.
 *
 * Both keys and values are already-normalized names (lowercase, punctuation and
 * generational suffixes stripped), because `normalizeName` applies this map as
 * its last step. Map the nickname form to the name Sleeper uses, since Sleeper
 * is the player directory every other source is matched against.
 *
 * To add one: confirm both spellings refer to the same player -- ideally that
 * the two directories agree on an external id -- then add
 * `'<nickname form>': '<sleeper form>'` and a case to aliases.test.ts.
 */
export const NAME_ALIASES: Record<string, string> = {
  // Marquise "Hollywood" Brown, WR. Sleeper and ESPN agree on id 4241372.
  'hollywood brown': 'marquise brown',
  // Zonovan "Bam" Knight, RB.
  'bam knight': 'zonovan knight',
  // Antwane "Juice" Wells Jr., WR. FantasyPros also carries the suffix.
  'juice wells': 'antwane wells',
  // DeaMonte "Chip" Trayanum, RB.
  'chip trayanum': 'deamonte trayanum',
}

/** Resolves a normalized name to its canonical form, if it has one. */
export function resolveNameAlias(normalized: string): string {
  return NAME_ALIASES[normalized] ?? normalized
}
