import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPlayerIdCrosswalk,
  clearPlayerIdCrosswalkCache,
  loadPlayerIdCrosswalk,
  parsePlayerIdCsv,
  PLAYER_ID_CROSSWALK_URL,
  splitCsvLine,
} from './playerIdCrosswalk'

afterEach(() => {
  clearPlayerIdCrosswalkCache()
  vi.unstubAllGlobals()
})

const CSV = [
  'sleeper_id,sleeper_name,sleeper_position,yahoo_id,yahoo_name,espn_id,espn_name',
  '9221,Jahmyr Gibbs,RB,40059,Jahmyr Gibbs,4429795,Jahmyr Gibbs',
  '9509,Bijan Robinson,RB,40055,Bijan Robinson,4430807,Bijan Robinson',
  '7564,Ja\'Marr Chase,WR,33393,Ja\'Marr Chase,4362628,Ja\'Marr Chase',
  '4034,Christian McCaffrey,RB,7847,Christian McCaffrey,3117251,Christian McCaffrey',
  '23,Jason Witten,TE,,,,,',
].join('\n')

describe('parsePlayerIdCsv', () => {
  it('indexes ESPN and Yahoo ids by Sleeper id', () => {
    const map = parsePlayerIdCsv(CSV)
    expect(map.get('9221')).toEqual({ espnId: '4429795', yahooId: '40059' })
    expect(map.get('9509')).toEqual({ espnId: '4430807', yahooId: '40055' })
    expect(map.get('7564')?.espnId).toBe('4362628')
    expect(map.has('23')).toBe(false)
  })

  it('keeps quoted commas inside a field', () => {
    expect(splitCsvLine('9221,"Gibbs, Jahmyr",RB')).toEqual(['9221', 'Gibbs, Jahmyr', 'RB'])
  })
})

describe('applyPlayerIdCrosswalk', () => {
  const map = parsePlayerIdCsv(CSV)
  const player = {
    id: '9221',
    sleeperId: '9221',
    espnId: undefined as string | undefined,
    yahooId: undefined as string | undefined,
  }

  it('fills blank ESPN and Yahoo ids for Gibbs and Bijan', () => {
    const [gibbs, bijan] = applyPlayerIdCrosswalk([
      player,
      { id: '9509', sleeperId: '9509' },
    ], map)
    expect(gibbs).toMatchObject({ espnId: '4429795', yahooId: '40059' })
    expect(bijan).toMatchObject({ espnId: '4430807', yahooId: '40055' })
  })

  it('does not overwrite a Sleeper-published ESPN id', () => {
    const [cmc] = applyPlayerIdCrosswalk([{ id: '4034', sleeperId: '4034', espnId: '3117251' }], map)
    expect(cmc?.espnId).toBe('3117251')
  })

  it('returns the same array when nothing changes', () => {
    const players = [{ id: 'nobody' }]
    expect(applyPlayerIdCrosswalk(players, map)).toBe(players)
  })
})

describe('loadPlayerIdCrosswalk', () => {
  it('parses the GitHub sheet and memoizes the map', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV, { headers: { 'content-type': 'text/csv' } }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await loadPlayerIdCrosswalk()
    const second = await loadPlayerIdCrosswalk()
    expect(first.get('9221')?.espnId).toBe('4429795')
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls.at(0)?.at(0))).toBe(PLAYER_ID_CROSSWALK_URL)
  })

  it('returns an empty map when the sheet is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(loadPlayerIdCrosswalk()).resolves.toEqual(new Map())
  })
})
