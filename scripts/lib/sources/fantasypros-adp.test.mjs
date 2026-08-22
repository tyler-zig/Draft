import { describe, expect, it } from 'vitest'
import { __test__ } from './fantasypros-adp.mjs'

const {
  buildUrl, toRow, seasonFor, boardFor, RT_ADP_BOARDS, EXPERT_ID,
  readPublished, previousPublished, canReuseSet, parsePublishedAt, reusePreviousSet,
} = __test__

const entry = {
  rank: '1',
  pos_rank: 'RB1',
  rank_ecr: 1,
  rank_ecr_min: '1',
  rank_ecr_max: '1',
  rank_adp_raw: '1.50',
  rank_adp_overall: '1',
  rank_last_seven: '1.20',
  rank_vs_last_seven: -0.3,
  rank_last_one: '4.20',
  rank_vs_last_one: 2.7,
  player_id: 22968,
  player_name: 'Jahmyr Gibbs',
  player_team_id: 'DET',
  player_positions: 'RB',
  player_owned_avg: 99.5,
  player_owned_espn: 99.9,
  player_owned_yahoo: 100,
  bye_week: '6',
}

describe('toRow', () => {
  it('maps the page payload to a ranking row and uses rank_adp_raw as ADP', () => {
    const row = toRow(entry)
    expect(row.name).toBe('Jahmyr Gibbs')
    expect(row.team).toBe('DET')
    expect(row.position).toBe('RB')
    expect(row.overall).toBe(1)
    expect(row.adp).toBe(1.5)
    expect(row.best).toBe(1)
    expect(row.worst).toBe(1)
    expect(row.average).toBe(1.5)
    expect(row.tier).toBeNull()
    expect(row.positionRank).toBe('RB1')
    expect(row.byeWeek).toBe(6)
    expect(row.fantasyProsId).toBe('22968')
    expect(row.ownedAvg).toBe(99.5)
    expect(row.ownedEspn).toBe(99.9)
    expect(row.ownedYahoo).toBe(100)
    expect(row.adpLastOne).toBe(4.2)
    expect(row.adpLastSeven).toBe(1.2)
    expect(row.adpVsLastOne).toBe(2.7)
    expect(row.adpVsLastSeven).toBe(-0.3)
  })

  it('keeps the page ADP (105.6) instead of consensus rank', () => {
    expect(toRow({
      ...entry,
      rank: '102',
      rank_adp_raw: '105.60',
      rank_adp_overall: '102',
      rank_ecr: 121,
      player_name: 'Houston Texans',
      player_positions: 'DST',
      player_team_id: 'HOU',
    }).adp).toBe(105.6)
  })

  it('falls back to overall rank when rank_adp_raw is missing', () => {
    expect(toRow({ ...entry, rank_adp_raw: null, rank: '12' }).adp).toBe(12)
  })

  it('drops a row with no name or no rank', () => {
    expect(toRow({ ...entry, player_name: '' })).toBeNull()
    expect(toRow({ ...entry, player_name: '  ' })).toBeNull()
    expect(toRow({ ...entry, rank: null, rank_adp_overall: null })).toBeNull()
    expect(toRow({ ...entry, rank: '0', rank_adp_overall: '0' })).toBeNull()
  })

  it('keeps defense names and ids when the API sends them', () => {
    const row = toRow({ ...entry, player_id: 8123, player_name: 'Buffalo Bills', player_positions: 'DST', player_team_id: 'BUF' })
    expect(row.position).toBe('DEF')
    expect(row.fantasyProsId).toBe('8123')
  })
})

describe('buildUrl', () => {
  it('builds the half-PPR request the page itself makes', () => {
    expect(buildUrl(2026)).toBe(
      `https://partners.fantasypros.com/api/v1/expert-rankings.php?id=${EXPERT_ID}&year=2026&position=ALL&type=adp&scoring=HALF`,
    )
  })

  it('uses the page\'s type and scoring token per format', () => {
    expect(buildUrl(2026, 'redraft-ppr', 'QB')).toContain('scoring=PPR')
    expect(buildUrl(2026, 'redraft-ppr', 'QB')).toContain('position=QB')
    expect(buildUrl(2026, 'redraft-std')).toContain('scoring=STD')
    expect(buildUrl(2026, 'dynasty')).toContain('type=dynadp')
    expect(buildUrl(2026, 'rookie')).toContain('type=rkadp')
    expect(buildUrl(2026, 'rookie')).toContain('scoring=HALF')
  })

  it('keeps the five page datasets and the legacy half-PPR set id', () => {
    expect(RT_ADP_BOARDS.map((board) => board.key)).toEqual([
      'redraft-half', 'redraft-ppr', 'redraft-std', 'dynasty', 'rookie',
    ])
    expect(boardFor('redraft-half').id).toBe('fantasypros-rtadp')
  })
})

describe('published stamp and ADP windows', () => {
  it('reads published from the compact ALL payload prefix', () => {
    expect(readPublished('{"count":269,"published":"2026-08-22 12:20:04","players":[')).toBe('2026-08-22 12:20:04')
    expect(readPublished('{ "published" : "2026-08-22 12:20:04" }')).toBe('2026-08-22 12:20:04')
    expect(readPublished('{"players":[]}')).toBeNull()
  })

  it('reuses a stored board only when the stamp matches and rows are intact', () => {
    const previous = { id: 'fantasypros-rtadp', rows: Array.from({ length: 100 }, () => ({ name: 'A', adpLastOne: 4.2, adpLastSeven: 1.2 })), meta: { lastUpdated: '2026-08-22 12:20:04' } }
    expect(previousPublished(previous)).toBe('2026-08-22 12:20:04')
    expect(canReuseSet(previous, 100)).toBe(true)
    expect(canReuseSet({ rows: [] }, 100)).toBe(false)
    expect(canReuseSet({ rows: Array.from({ length: 100 }, () => ({ name: 'A' })), meta: { lastUpdated: '2026-08-22 12:20:04' } }, 100)).toBe(false)
    const reused = reusePreviousSet(previous, '2026-08-22 12:20:04')
    expect(reused.meta.reused).toBe(true)
    expect(reused.meta.lastUpdated).toBe('2026-08-22 12:20:04')
    expect(reused.rows).toHaveLength(100)
    expect(reused.fetchedAt).toBeGreaterThan(0)
  })

  it('places the 1-day and 7-day windows on an Eastern published clock', () => {
    expect(parsePublishedAt('2026-08-22 12:20:04')).toBe(Date.parse('2026-08-22T12:20:04-04:00'))
    expect(parsePublishedAt('not a stamp')).toBeNull()
  })

  it('keeps the page identity that vs_last_* is window minus current ADP', () => {
    const row = toRow({
      ...entry,
      rank: '102',
      rank_adp_raw: '105.60',
      rank_last_seven: '110.10',
      rank_vs_last_seven: 4.5,
      rank_last_one: '114.90',
      rank_vs_last_one: 9.3,
      player_name: 'Houston Texans',
      player_positions: 'DST',
      player_team_id: 'HOU',
    })
    expect(row.adp).toBe(105.6)
    expect(row.adpLastSeven - row.adp).toBeCloseTo(row.adpVsLastSeven)
    expect(row.adpLastOne - row.adp).toBeCloseTo(row.adpVsLastOne)
  })
})

describe('seasonFor', () => {
  it('labels the season by the year it starts', () => {
    expect(seasonFor(new Date('2026-08-15T00:00:00Z'))).toBe(2026)
    expect(seasonFor(new Date('2026-03-15T00:00:00Z'))).toBe(2025)
  })
})
