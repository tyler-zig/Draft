import { describe, expect, it } from 'vitest'
import { parseSleeperRef } from './sleeperRef'

describe('parseSleeperRef', () => {
  it('reads a beta mock-draft URL', () => {
    expect(parseSleeperRef('https://sleeper.com/beta/draft/nfl/1402482382057000960'))
      .toEqual({ kind: 'draft', id: '1402482382057000960' })
  })

  it('reads a live draft path, a league predraft path, and a bare id', () => {
    expect(parseSleeperRef('sleeper.com/draft/nfl/1402482382057000960'))
      .toEqual({ kind: 'draft', id: '1402482382057000960' })
    expect(parseSleeperRef('https://sleeper.com/leagues/1401696318404952064/predraft'))
      .toEqual({ kind: 'league', id: '1401696318404952064' })
    expect(parseSleeperRef('1402482382057000960'))
      .toEqual({ kind: 'draft', id: '1402482382057000960' })
  })

  it('rejects an empty or unrelated string', () => {
    expect(parseSleeperRef('')).toBeNull()
    expect(parseSleeperRef('https://sleeper.com/chopped')).toBeNull()
  })
})
