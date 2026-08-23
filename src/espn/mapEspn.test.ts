import { describe, expect, it } from 'vitest'
import {
  espnSnapshotPickCount,
  espnSnapshotPickStamp,
  mergeEspnSnapshots,
  isEspnPracticeLeague,
  mapEspnKeeperCandidates,
  mapEspnKeepers,
  mapEspnLeague,
  mapEspnPicks,
  mapEspnPlayers,
  mapEspnSession,
  mapReceptionPremium,
  mapScoringSettings,
  shouldFollowEspnSnapshot,
  type EspnSnapshot,
} from './mapEspn'

function snapshot(overrides: Partial<EspnSnapshot['league']> = {}): EspnSnapshot {
  return {
    leagueId: '1',
    season: '2026',
    teamId: '1',
    fetchedAt: 0,
    players: [],
    league: {
      settings: {
        name: 'Keeper League',
        size: 4,
        draftSettings: { type: 'SNAKE', keeperCount: 2 },
      },
      teams: [
        { id: 1, name: 'Team 1', draftPosition: 1 },
        { id: 2, name: 'Team 2', draftPosition: 2 },
        { id: 3, name: 'Team 3', draftPosition: 3 },
        { id: 4, name: 'Team 4', draftPosition: 4 },
      ],
      ...overrides,
    },
  }
}

describe('mapEspnPicks', () => {
  it('keeps a keeper row ESPN has not stamped with an overall pick number', () => {
    const picks = mapEspnPicks(
      snapshot({ draftDetail: { picks: [{ playerId: 99, teamId: 2, roundId: 3, keeper: true }] } }),
    )
    expect(picks).toHaveLength(1)
    // Round 3 is odd, so slot 2 picks 10th in a 4-team draft.
    expect(picks[0]).toMatchObject({ playerId: '99', pickNo: 10, round: 3, isKeeper: true })
  })

  it('still drops rows that are neither keepers nor made picks', () => {
    const picks = mapEspnPicks(
      snapshot({ draftDetail: { picks: [{ playerId: 99, teamId: 2, roundId: 3 }] } }),
    )
    expect(picks).toEqual([])
  })

  it('keeps a live pick identified by round and round-pick fields', () => {
    const picks = mapEspnPicks(
      snapshot({ draftDetail: { picks: [{ playerId: 99, teamId: 2, roundId: 2, roundPickNumber: 3 }] } }),
    )
    expect(picks).toHaveLength(1)
    expect(picks[0]).toMatchObject({ playerId: '99', pickNo: 7, round: 2, isKeeper: false })
  })

  it('prefers the overall pick number ESPN supplies', () => {
    const picks = mapEspnPicks(
      snapshot({
        draftDetail: { picks: [{ playerId: 99, teamId: 2, roundId: 3, overallPickNumber: 11, keeper: true }] },
      }),
    )
    expect(picks[0]?.pickNo).toBe(11)
  })

  it('recognizes ESPN reservedForKeeper rows', () => {
    const picks = mapEspnPicks(
      snapshot({
        draftDetail: {
          picks: [{ playerId: 99, teamId: 2, roundId: 3, roundPickNumber: 2, overallPickNumber: 10, reservedForKeeper: true }],
        },
      }),
    )
    expect(picks[0]).toMatchObject({ playerId: '99', pickNo: 10, isKeeper: true })
  })
})

describe('ESPN draft order with keepers', () => {
  it('uses one later-round keeper as authoritative evidence for your slot', () => {
    const session = mapEspnSession(
      snapshot({
        settings: {
          name: 'Practice Draft for The Best League',
          size: 4,
          draftSettings: { type: 'SNAKE' },
        },
        draftDetail: {
          picks: [{ playerId: 99, teamId: 4, roundId: 7, roundPickNumber: 4, overallPickNumber: 28, reservedForKeeper: true }],
        },
      }),
      '4',
    )
    expect(session.yourSlot).toBe(4)
    expect(session.order.map((slot) => slot.rosterId)).toEqual(['1', '2', '3', '4'])
  })

  it('mirrors even-round keeper positions back to the draft slot', () => {
    const session = mapEspnSession(
      snapshot({
        settings: { name: 'League', size: 4, draftSettings: { type: 'SNAKE' } },
        draftDetail: {
          picks: [{ playerId: 99, teamId: 4, roundId: 2, roundPickNumber: 1, overallPickNumber: 5, reservedForKeeper: true }],
        },
      }),
      '4',
    )
    expect(session.yourSlot).toBe(4)
    expect(new Set(session.order.map((slot) => slot.rosterId)).size).toBe(4)
  })

  it('prefers ESPN pickOrder when it is complete', () => {
    const session = mapEspnSession(
      snapshot({
        settings: {
          name: 'League',
          size: 4,
          draftSettings: { type: 'SNAKE', pickOrder: [4, 2, 1, 3] },
        },
      }),
      '4',
    )
    expect(session.yourSlot).toBe(1)
    expect(session.order.map((slot) => slot.rosterId)).toEqual(['4', '2', '1', '3'])
  })
})

describe('mapEspnKeepers', () => {
  it('reads locked keepers off the draft detail', () => {
    const keepers = mapEspnKeepers(
      snapshot({
        draftDetail: {
          picks: [
            { playerId: 99, teamId: 2, roundId: 3, keeper: true },
            { playerId: 12, teamId: 1, roundId: 1, overallPickNumber: 1 },
          ],
        },
      }),
    )
    expect(keepers).toEqual([{ playerId: '99', rosterId: '2', round: 3, source: 'espn' }])
  })

  it('reads ESPN reservedForKeeper as a locked keeper', () => {
    const keepers = mapEspnKeepers(
      snapshot({
        draftDetail: {
          picks: [{ playerId: 99, teamId: 2, roundId: 3, reservedForKeeper: true }],
        },
      }),
    )
    expect(keepers).toEqual([{ playerId: '99', rosterId: '2', round: 3, source: 'espn' }])
  })

  it('is empty before the commissioner locks keepers', () => {
    expect(mapEspnKeepers(snapshot({ draftDetail: { picks: [] } }))).toEqual([])
  })
})

describe('mapEspnKeeperCandidates', () => {
  it('reports each rostered player with the round he costs', () => {
    const candidates = mapEspnKeeperCandidates(
      snapshot({
        teams: [
          {
            id: 2,
            name: 'Team 2',
            roster: {
              entries: [
                { playerId: 7, playerPoolEntry: { id: 7, keeperValue: 4 } },
                { playerId: 8, playerPoolEntry: { id: 8, keeperValue: 0 } },
              ],
            },
          },
        ],
      }),
    )
    expect(candidates).toEqual([
      { playerId: '7', rosterId: '2', round: 4 },
      { playerId: '8', rosterId: '2', round: null },
    ])
  })
})

describe('ESPN practice drafts', () => {
  it('treats CUSTOM_MOCK and MOCKDRAFT_LOBBY as practice', () => {
    expect(isEspnPracticeLeague({ settings: { name: 'Practice Draft for The Best League' } })).toBe(true)
    expect(isEspnPracticeLeague({ settings: { name: 'Mock Draft for The Best League' } })).toBe(true)
    expect(isEspnPracticeLeague({ settings: { leagueSubType: 'CUSTOM_MOCK' } })).toBe(true)
    expect(isEspnPracticeLeague({ settings: { leagueSubType: 'custom mock' } })).toBe(true)
    expect(isEspnPracticeLeague({ settings: { leagueSubType: 5 as unknown as string } })).toBe(true)
    expect(isEspnPracticeLeague({ settings: { leagueSubTypeId: '4' as unknown as number } })).toBe(true)
    expect(isEspnPracticeLeague({ settings: { leagueSubTypeId: 4 } })).toBe(true)
    expect(isEspnPracticeLeague({ settings: { leagueSubType: 'NONE' } })).toBe(false)
  })

  it('labels the session and drops keepers', () => {
    const practice = snapshot({ settings: { name: 'Home League', size: 4, leagueSubType: 'CUSTOM_MOCK', draftSettings: { type: 'SNAKE', keeperCount: 2 } } })
    const session = mapEspnSession(practice, '1')
    expect(session.isPractice).toBe(true)
    expect(session.name).toBe('Home League (Practice)')
    expect(session.keeperCount).toBeNull()
    expect(mapEspnLeague(practice).isPractice).toBe(true)
    expect(mapEspnKeepers(practice)).toEqual([])
    expect(mapEspnKeeperCandidates(practice)).toEqual([])
  })

  it('follows a live practice snapshot onto a new league id', () => {
    const live = snapshot({ draftDetail: { inProgress: true } })
    live.leagueId = '999'
    expect(shouldFollowEspnSnapshot('2026:1', live)).toBe(true)
    expect(shouldFollowEspnSnapshot('2026:999', live)).toBe(false)
    expect(shouldFollowEspnSnapshot('2026:1', snapshot())).toBe(false)
  })

  it('follows a practice draft room before ESPN flips inProgress', () => {
    const live = snapshot({ draftDetail: { drafted: false, inProgress: false } })
    live.leagueId = '650239158'
    live.isPractice = true
    live.pageUrl = 'https://fantasy.espn.com/football/draft?leagueId=650239158&seasonId=2026&teamId=19&memberId={605B6653-A8B8-403F-85DA-E4618F649E74}'
    expect(shouldFollowEspnSnapshot('2026:1', live)).toBe(true)
    expect(shouldFollowEspnSnapshot('2026:650239158', live)).toBe(false)
  })

  it('leaves a dead practice room when the real league is back', () => {
    const home = snapshot()
    home.leagueId = '1'
    home.pageUrl = 'https://fantasy.espn.com/football/team?leagueId=1&seasonId=2026'
    expect(shouldFollowEspnSnapshot('2026:650239158', home)).toBe(true)
  })

  it('does not follow a finished practice clone', () => {
    const done = snapshot({ draftDetail: { drafted: true, inProgress: false } })
    done.leagueId = '650239158'
    done.isPractice = true
    done.pageUrl = 'https://fantasy.espn.com/football/draft?leagueId=650239158'
    expect(shouldFollowEspnSnapshot('2026:1', done)).toBe(false)
  })
})

describe('mapEspnSession', () => {
  it('carries the league keeper limit', () => {
    expect(mapEspnSession(snapshot(), '1').keeperCount).toBe(2)
  })

  it('carries the live draft-room clock when the injector scraped one', () => {
    const live = snapshot()
    live.clock = { remaining: 87, endsAt: 1_700_000_087_000, paused: false }
    const session = mapEspnSession(live, '1')
    expect(session.clockEndsAt).toBe(1_700_000_087_000)
    expect(session.clockPaused).toBe(false)
  })

  it('freezes a paused ESPN clock', () => {
    const live = snapshot()
    live.clock = { remaining: 41, endsAt: 1_700_000_041_000, paused: true }
    const session = mapEspnSession(live, '1')
    expect(session.clockEndsAt).toBeNull()
    expect(session.clockPaused).toBe(true)
  })

  it('keeps ESPN team logos when the snapshot includes a URL', () => {
    const session = mapEspnSession(
      snapshot({
        teams: [
          { id: 1, name: 'Team 1', draftPosition: 1, logo: 'https://g.espncdn.com/logo.png' },
          { id: 2, name: 'Team 2', draftPosition: 2 },
          { id: 3, name: 'Team 3', draftPosition: 3 },
          { id: 4, name: 'Team 4', draftPosition: 4 },
        ],
      }),
      '1',
    )
    expect(session.order[0]?.avatar).toBe('https://g.espncdn.com/logo.png')
    expect(session.order[1]?.avatar).toBeNull()
  })
})

function scoringSnapshot(points: number, pointsOverrides?: Record<string, number>): EspnSnapshot {
  const base = snapshot()
  return {
    ...base,
    league: {
      ...base.league,
      settings: {
        ...base.league?.settings,
        scoringSettings: { scoringItems: [{ statId: 53, points, pointsOverrides }] },
      },
    },
  }
}

describe('ESPN scoring detection', () => {
  it('classifies full, half and standard by reception points', () => {
    expect(mapEspnSession(scoringSnapshot(1), '1').scoringType).toBe('ppr')
    expect(mapEspnSession(scoringSnapshot(0.5), '1').scoringType).toBe('half_ppr')
    expect(mapEspnSession(scoringSnapshot(0), '1').scoringType).toBe('std')
  })

  it('reports unknown when the league has no reception item', () => {
    expect(mapEspnSession(snapshot(), '1').scoringType).toBe('unknown')
  })

  it('still classifies a TE-premium league by its base rate', () => {
    expect(mapEspnSession(scoringSnapshot(1, { '6': 1.5 }), '1').scoringType).toBe('ppr')
  })
})

describe('mapReceptionPremium', () => {
  it('names the position paid a different rate', () => {
    const session = mapEspnSession(scoringSnapshot(1, { '6': 1.5 }), '1')
    expect(session.receptionPremium).toEqual([{ position: 'TE', points: 1.5 }])
  })

  it('ignores overrides that merely restate the base rate', () => {
    const session = mapEspnSession(scoringSnapshot(1, { '6': 1, '4': 1 }), '1')
    expect(session.receptionPremium).toBeNull()
  })

  it('is null for a league with no overrides', () => {
    expect(mapEspnSession(scoringSnapshot(0.5), '1').receptionPremium).toBeNull()
    expect(mapReceptionPremium({})).toBeNull()
  })
})

describe('mapScoringSettings', () => {
  it('converts known statIds to the shared pass_yd/rec/... key shape', () => {
    const league = {
      settings: {
        scoringSettings: {
          scoringItems: [
            { statId: 4, points: 6 }, // pass_td (6pt league)
            { statId: 25, points: 6 }, // rush_td
            { statId: 53, points: 1 }, // rec
            { statId: 999, points: 5 }, // unrecognized -- dropped, not guessed
          ],
        },
      },
    }
    expect(mapScoringSettings(league)).toEqual({ pass_td: 6, rush_td: 6, rec: 1 })
  })

  it('resolves either known id in a duplicate pair to the same key', () => {
    expect(mapScoringSettings({ settings: { scoringSettings: { scoringItems: [{ statId: 3, points: 0.04 }] } } })).toEqual({ pass_yd: 0.04 })
    expect(mapScoringSettings({ settings: { scoringSettings: { scoringItems: [{ statId: 22, points: 0.04 }] } } })).toEqual({ pass_yd: 0.04 })
  })

  it('is null with no scoring items or none recognized', () => {
    expect(mapScoringSettings({})).toBeNull()
    expect(mapScoringSettings({ settings: { scoringSettings: { scoringItems: [{ statId: 999, points: 5 }] } } })).toBeNull()
  })

  it('flows through mapEspnSession onto DraftSession.scoringSettings', () => {
    const session = mapEspnSession(scoringSnapshot(1), '1')
    expect(session.scoringSettings).toEqual({ rec: 1 })
  })
})

describe('mapEspnPlayers ADP', () => {
  const withPlayer = (ownership?: { averageDraftPosition?: number }): EspnSnapshot => ({
    ...snapshot(),
    players: [{ id: 7, player: { id: 7, fullName: 'Real Back', firstName: 'Real', lastName: 'Back', defaultPositionId: 2, proTeamId: 6, ownership } }],
  })

  it('reads ESPN average draft position', () => {
    expect(mapEspnPlayers(withPlayer({ averageDraftPosition: 14.4 }))[0]?.adp).toBe(14.4)
  })

  it('treats a zero ADP as never drafted, not as the first pick', () => {
    expect(mapEspnPlayers(withPlayer({ averageDraftPosition: 0 }))[0]?.adp).toBeNull()
  })

  it('is null when ESPN reports no ownership', () => {
    expect(mapEspnPlayers(withPlayer())[0]?.adp).toBeNull()
  })
})

describe('espnSnapshotPickStamp', () => {
  it('matches the extension overlay stamp', () => {
    const live = snapshot({
      draftDetail: {
        picks: [
          { playerId: 7, overallPickNumber: 1 },
          { playerId: 9, overallPickNumber: 2 },
        ],
      },
    })
    expect(espnSnapshotPickStamp(live)).toBe('2:9:2::')
    expect(espnSnapshotPickStamp(null)).toBe('0::::')
  })
})

describe('a board ESPN publishes that is not a plain snake', () => {
  // Reduced from a real 12-team ESPN practice draft with three keeper rounds.
  // ESPN runs the keeper rounds (1-3) in straight draft order and only starts
  // snaking at round 4, so plain odd/even parity agrees with it in rounds 1
  // and 3 and mirrors every other round.
  const ORDER = [21, 23, 12, 24, 5, 15, 16, 1, 19, 20, 25, 7]
  const FORWARD = new Set([1, 2, 3, 4, 6, 8, 10, 12, 14])
  const YOUR_TEAM = 19

  function espnBoard(): EspnSnapshot {
    const picks: Array<Record<string, unknown>> = []
    for (let round = 1; round <= 15; round += 1) {
      const order = FORWARD.has(round) ? ORDER : [...ORDER].reverse()
      order.forEach((teamId, index) => {
        const keeper = teamId === YOUR_TEAM && round <= 3
        picks.push({
          overallPickNumber: (round - 1) * 12 + index + 1,
          roundId: round,
          roundPickNumber: index + 1,
          teamId,
          // ESPN fills the whole board up front; unmade picks carry -1.
          playerId: keeper ? 4426502 + round : -1,
          keeper: keeper || undefined,
          reservedForKeeper: round <= 3 || undefined,
        })
      })
    }
    return {
      leagueId: '1882426813', season: '2026', teamId: String(YOUR_TEAM), fetchedAt: 0, players: [],
      league: {
        settings: {
          name: 'Practice Draft for The Best League', size: 12,
          draftSettings: { type: 'SNAKE', keeperCount: 3, pickOrder: ORDER },
        },
        teams: ORDER.map((id) => ({ id })),
        draftDetail: { picks },
      },
    } as unknown as EspnSnapshot
  }

  it('reads pick ownership off the published board instead of snake parity', () => {
    const session = mapEspnSession(espnBoard(), String(YOUR_TEAM))
    expect(session.yourSlot).toBe(9)
    const owners = session.pickOwners!
    expect(owners).toHaveLength(180)
    // Round 2 runs forward here; parity alone would hand pick 16 to slot 9.
    expect(owners[15]).toBe(4)
    expect(owners[20]).toBe(9)
    const yours = owners.flatMap((slot, index) => (slot === 9 ? [index + 1] : []))
    expect(yours.slice(0, 7)).toEqual([9, 21, 33, 45, 52, 69, 76])
  })

  it('keeps your keepers on the picks ESPN gave them', () => {
    const picks = mapEspnPicks(espnBoard()).filter((pick) => pick.isKeeper)
    expect(picks.map((pick) => pick.pickNo)).toEqual([9, 21, 33])
    // The 177 unmade rows are board scaffolding, not picks.
    expect(mapEspnPicks(espnBoard())).toHaveLength(3)
  })
})

describe('team defenses', () => {
  // ESPN numbers D/ST negatively -- the Texans are -16034, per the espnId in
  // the collected ranking sources. Only -1 means "nobody has made this pick",
  // so a sign test drops every drafted defense along with the placeholders.
  const TEXANS_DST = -16034

  it('keeps a drafted defense on the board', () => {
    const picks = mapEspnPicks(snapshot({
      draftDetail: {
        picks: [
          { playerId: TEXANS_DST, teamId: 2, roundId: 3, roundPickNumber: 2, overallPickNumber: 10 },
          { playerId: 99, teamId: 1, roundId: 1, roundPickNumber: 1, overallPickNumber: 1 },
        ],
      },
    }))
    expect(picks.map((pick) => pick.playerId)).toEqual(['99', '-16034'])
  })

  it('still drops the unmade-pick placeholders', () => {
    const picks = mapEspnPicks(snapshot({
      draftDetail: {
        picks: [
          { playerId: -1, teamId: 1, roundId: 1, roundPickNumber: 1, overallPickNumber: 1 },
          { playerId: -1, teamId: 2, roundId: 1, roundPickNumber: 2, overallPickNumber: 2 },
        ],
      },
    }))
    expect(picks).toEqual([])
  })

  it('keeps a kept defense', () => {
    const keepers = mapEspnKeepers(snapshot({
      draftDetail: { picks: [{ playerId: TEXANS_DST, teamId: 2, roundId: 9, keeper: true }] },
    }))
    expect(keepers).toEqual([{ playerId: '-16034', rosterId: '2', round: 9, source: 'espn' }])
  })
})

describe('scoring detection', () => {
  const withItems = (items: Array<{ statId: number; points: number }> | undefined) =>
    mapEspnSession(snapshot({
      settings: { name: 'L', size: 4, draftSettings: { type: 'SNAKE' }, scoringSettings: items ? { scoringItems: items } : undefined },
    }), '1').scoringType

  it('reads full and half PPR off the reception item', () => {
    expect(withItems([{ statId: 53, points: 1 }])).toBe('ppr')
    expect(withItems([{ statId: 53, points: 0.5 }])).toBe('half_ppr')
  })

  it('treats a published board with no reception item as standard', () => {
    // ESPN lists only the stats a league scores; standard leagues omit 53.
    expect(withItems([{ statId: 3, points: 4 }, { statId: 42, points: 6 }])).toBe('std')
  })

  it('reports a zero-point reception item as standard', () => {
    expect(withItems([{ statId: 53, points: 0 }])).toBe('std')
  })

  it('only says unknown when nothing was published at all', () => {
    expect(withItems(undefined)).toBe('unknown')
    expect(withItems([])).toBe('unknown')
  })
})

describe('mergeEspnSnapshots', () => {
  const pick = (overall: number, playerId: number, teamId = 1) =>
    ({ overallPickNumber: overall, playerId, teamId, roundId: Math.ceil(overall / 2), roundPickNumber: ((overall - 1) % 2) + 1 })
  const EMPTY = -1

  const snap = (picks: unknown[], extra: Record<string, unknown> = {}) => ({
    leagueId: '146234', season: '2026', fetchedAt: Date.now(),
    league: {
      settings: { size: 2, name: 'The Best League' },
      teams: [{ id: 1 }, { id: 2 }],
      draftDetail: { inProgress: true, drafted: false, picks, ...(extra.draftDetail ?? {}) },
    },
    ...extra,
  }) as unknown as EspnSnapshot

  it('keeps picks a degraded snapshot no longer knows about', () => {
    // The live case: the assistant had the full board, then the ESPN tab was
    // disconnected and the read model came back with keepers only.
    const cached = snap([pick(1, 101), pick(2, 102), pick(3, 103), pick(4, 104)])
    const incoming = snap([pick(1, 101), pick(2, EMPTY), pick(3, EMPTY), pick(4, EMPTY)])
    const merged = mergeEspnSnapshots(cached, incoming)
    expect(espnSnapshotPickCount(merged)).toBe(4)
    expect(mapEspnPicks(merged).map((p) => p.playerId).sort()).toEqual(['101', '102', '103', '104'])
  })

  it('does not leave both a retained pick and its placeholder on the board', () => {
    const cached = snap([pick(1, 101), pick(2, 102)])
    const incoming = snap([pick(1, 101), pick(2, EMPTY)])
    const picks = mergeEspnSnapshots(cached, incoming).league!.draftDetail!.picks!
    expect(picks.filter((p) => p.overallPickNumber === 2)).toHaveLength(1)
  })

  it('takes new picks from the incoming snapshot', () => {
    const cached = snap([pick(1, 101), pick(2, 102)])
    const incoming = snap([pick(1, 101), pick(2, 102), pick(3, 103)])
    expect(espnSnapshotPickCount(mergeEspnSnapshots(cached, incoming))).toBe(3)
  })

  it('prefers the incoming pick when both know a slot', () => {
    const cached = snap([pick(1, 101)])
    const incoming = snap([pick(1, 999)])
    expect(mapEspnPicks(mergeEspnSnapshots(cached, incoming))[0]?.playerId).toBe('999')
  })

  it('lets a completed draft replace the board outright', () => {
    // Once ESPN publishes the finished draft its read model is authoritative,
    // which is what clears a rolled-back pick.
    const cached = snap([pick(1, 101), pick(2, 102)])
    const incoming = snap([pick(1, 101)], { draftDetail: { drafted: true, inProgress: false } })
    expect(espnSnapshotPickCount(mergeEspnSnapshots(cached, incoming))).toBe(1)
  })

  it('never carries picks between different drafts', () => {
    const cached = snap([pick(1, 101), pick(2, 102)])
    const other = { ...snap([pick(1, 501)]), leagueId: '999' } as EspnSnapshot
    expect(espnSnapshotPickCount(mergeEspnSnapshots(cached, other))).toBe(1)
    const nextSeason = { ...snap([pick(1, 501)]), season: '2027' } as EspnSnapshot
    expect(espnSnapshotPickCount(mergeEspnSnapshots(cached, nextSeason))).toBe(1)
  })

  it('keeps a drafted defense, whose ESPN id is negative', () => {
    const cached = snap([pick(1, -16034), pick(2, 102)])
    const incoming = snap([pick(1, EMPTY), pick(2, EMPTY)])
    expect(mapEspnPicks(mergeEspnSnapshots(cached, incoming)).map((p) => p.playerId).sort())
      .toEqual(['-16034', '102'])
  })

  it('passes the incoming snapshot through when there is nothing cached', () => {
    const incoming = snap([pick(1, 101)])
    expect(mergeEspnSnapshots(null, incoming)).toBe(incoming)
  })
})
