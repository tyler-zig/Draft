/**
 * Suggestions for the ESPN draft-page overlay.
 *
 * This used to be a second implementation of the app's draft logic -- its own
 * snake math, snapshot mapping, roster needs and a simplified scorer -- because
 * the overlay has to answer the moment a pick lands and the app polls on a
 * timer. Keeping two copies meant fixing everything twice, and they drifted
 * until a draft-order bug had to be found and fixed separately in each.
 *
 * Now it is an adapter. The scoring lives in `core.bundle.js`, built from the
 * same `src/` the app runs, and the only thing left here is the join: read the
 * live snapshot for what changes every pick, read the app's published
 * valuations for what does not, and hand both to the shared recommender.
 *
 * With no valuations cached -- app never opened, or a different league -- the
 * scoring falls back to ESPN's own editorial rank, which is all this file ever
 * had to work with before.
 */
;(function (root) {
  function core() {
    return root.DraftAssistantCore ?? null
  }

  /** Only the app's numbers for this league, and only if it published any. */
  function valuationsFor(table, snapshot) {
    if (!table || !table.players || !snapshot?.leagueId) return null
    if (String(table.leagueId) !== String(snapshot.leagueId)) return null
    return table
  }

  function pickStamp(snapshot) {
    const api = core()
    if (api) return api.espnSnapshotPickStamp(snapshot)
    const picks = snapshot?.league?.draftDetail?.picks ?? []
    const last = picks[picks.length - 1]
    return `${picks.length}:${last?.playerId ?? ''}:${last?.overallPickNumber ?? ''}:${last?.roundId ?? ''}:${last?.roundPickNumber ?? ''}`
  }

  /**
   * @param snapshot the ESPN league payload the injected script scraped
   * @param table the app's published valuations, or null
   */
  function fromSnapshot(snapshot, table) {
    const api = core()
    const league = snapshot?.league
    if (!api || !league || !snapshot.leagueId) return null

    const teamId = snapshot.teamId ? String(snapshot.teamId) : ''
    const session = api.mapEspnSession(snapshot, teamId)
    const picks = api.mapEspnPicks(snapshot)
    const valuations = valuationsFor(table, snapshot)
    const players = api.applyValuations(api.mapEspnPlayers(snapshot), valuations)

    const taken = api.occupiedPickNumbers(picks)
    const currentPickNo = api.nextOpenPickNumber(taken, session.teams * session.rounds)
    const yourSlot = session.yourSlot
    const until = yourSlot == null
      ? null
      : api.picksUntilSlot(currentPickNo, yourSlot, session.teams, session.rounds, session.type, taken, session.pickOwners)
    const yourNextPickNo = yourSlot == null
      ? null
      : api.nextPickNumberForSlot(currentPickNo, yourSlot, session.teams, session.rounds, session.type, taken, session.pickOwners)

    const recs = api.suggestionSet(api.recommendPicks({
      players,
      picks,
      yourSlot,
      slots: session.slots,
      currentPickNo,
      yourNextPickNo,
      limit: 24,
    }), 5)

    const room = api.overlayRoom?.({
      players,
      picks,
      slots: session.slots,
      yourSlot,
      order: session.order,
      teams: session.teams,
      rounds: session.rounds,
      type: session.type,
      pickOwners: session.pickOwners,
      currentPickNo,
    }) ?? {}

    return {
      leagueId: String(snapshot.leagueId),
      season: String(snapshot.season || ''),
      teamId,
      currentPickNo,
      until,
      youAreOnClock: until === 0,
      pickStamp: pickStamp(snapshot),
      source: 'espn',
      // Whether these carry the app's numbers or only ESPN's editorial rank,
      // so the overlay can be honest about which it is showing.
      valued: Boolean(valuations),
      updatedAt: Date.now(),
      recs: recs.map((rec) => ({
        id: rec.player.id,
        name: rec.player.fullName,
        position: rec.player.position,
        reason: rec.reason,
        rank: rec.player.searchRank,
        ...(api.suggestionGlance ? api.suggestionGlance(rec.player, currentPickNo) : { team: rec.player.team }),
      })),
      ...room,
    }
  }

  const api = { fromSnapshot, pickStamp }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  root.DraftAssistantSuggest = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
