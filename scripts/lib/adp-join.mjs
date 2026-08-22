/**
 * Fills ADP onto FantasyPros ECR rows from the expert artifact.
 *
 * The ECR cheatsheet pages embed `ecrData`, which carries consensus rank but no
 * ADP, and FantasyPros serves its dedicated ADP board from `/ajax/` -- a path
 * their robots.txt disallows. The per-expert boards we already collect do print
 * ADP in every row, and `scrape-experts.mjs` stores it in the artifact's shared
 * player dictionary. Joining the two is the only ADP for these rows that does
 * not require fetching a disallowed endpoint.
 */

function nameKey(name, position) {
  return `${String(name ?? '').toLowerCase().replace(/[^a-z]/g, '')}:${position ?? ''}`
}

/** Index one expert artifact by FantasyPros id and by name+position. */
export function buildAdpIndex(artifact) {
  const byId = new Map()
  const byName = new Map()
  for (const [key, player] of Object.entries(artifact?.players ?? {})) {
    // Zero is never a draft position. Older artifacts are full of them from
    // blank cells parsing as 0, and treating one as real would rank that
    // player ahead of the first overall pick.
    if (player?.adp == null || player.adp <= 0) continue
    // Team-defense keys are synthetic (`T:TEAM:POS`) and are not real ids.
    if (!key.startsWith('T:')) byId.set(key, player.adp)
    const named = nameKey(player.n, player.p)
    if (!byName.has(named)) byName.set(named, player.adp)
  }
  return { byId, byName }
}

/**
 * Returns a copy of `rows` with `adp` filled where the index knows it.
 *
 * Existing values win: a source that reports its own ADP is closer to the
 * truth than a value borrowed from another board.
 */
export function joinAdp(rows, index) {
  let filled = 0
  const joined = rows.map((row) => {
    if (row.adp != null) return row
    const byId = row.fantasyProsId != null ? index.byId.get(String(row.fantasyProsId)) : undefined
    const adp = byId ?? index.byName.get(nameKey(row.name, row.position))
    if (adp == null) return row
    filled += 1
    return { ...row, adp }
  })
  return { rows: joined, filled }
}
