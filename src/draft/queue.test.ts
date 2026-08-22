import { beforeEach, describe, expect, it } from 'vitest'
import type { Player } from '../providers/types'
import { loadQueue, moveQueueItem, queueIdForPlayer, queueIncludesPlayer, resolveQueuePlayerIds, saveQueue } from './queue'

const player: Player = { id: 'espn-101', espnId: 'espn-101', sleeperId: 'sleeper-7', yahooId: 'yahoo-9', firstName: 'Queue', lastName: 'Player', fullName: 'Queue Player', position: 'RB', team: 'CHI', searchRank: 1, injuryStatus: null, number: null, yearsExp: 2, bye: null }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('moveQueueItem', () => {
  it('reorders queued players without mutating the source', () => {
    const source = ['a', 'b', 'c']
    expect(moveQueueItem(source, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveQueueItem(source, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(source).toEqual(['a', 'b', 'c'])
  })

  it('leaves invalid boundary moves unchanged', () => {
    const source = ['a', 'b']
    expect(moveQueueItem(source, 'a', -1)).toBe(source)
    expect(moveQueueItem(source, 'b', 1)).toBe(source)
  })
})

describe('shared draft queue', () => {
  it('uses the id native to the active provider and resolves legacy aliases', () => {
    expect(queueIdForPlayer(player, 'espn')).toBe('espn-101')
    expect(queueIdForPlayer(player, 'sleeper')).toBe('sleeper-7')
    expect(queueIdForPlayer(player, 'yahoo')).toBe('yahoo-9')
    expect(queueIncludesPlayer(['sleeper-7'], player)).toBe(true)
    expect(resolveQueuePlayerIds(['sleeper-7'], [player])).toEqual(['espn-101'])
  })

  it('persists queues durably while retaining the session copy', () => {
    saveQueue('espn:2026:league', ['espn-101'])
    expect(loadQueue('espn:2026:league')).toEqual(['espn-101'])
    expect(JSON.parse(localStorage.getItem('draft-assistant:queue:espn:2026:league') ?? 'null')).toEqual(['espn-101'])
    expect(JSON.parse(sessionStorage.getItem('draft-assistant:queue:espn:2026:league') ?? 'null')).toEqual(['espn-101'])
  })
})
