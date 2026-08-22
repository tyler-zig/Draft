import { describe, expect, it } from 'vitest'
import { demoProvider, espnProvider, nflProvider, sleeperProvider, yahooProvider } from './index'

describe('draft provider capabilities', () => {
  it('keeps live providers read-only', () => {
    expect(sleeperProvider.capabilities).toEqual({ draftPick: false, autoPick: false })
    expect(espnProvider.capabilities).toEqual({ draftPick: false, autoPick: false })
    expect(yahooProvider.capabilities).toEqual({ draftPick: false, autoPick: false })
    expect(nflProvider.capabilities).toEqual({ draftPick: false, autoPick: false })
  })

  it('limits mutation support to demo drafting', () => {
    expect(demoProvider.capabilities).toEqual({ draftPick: true, autoPick: false })
  })
})
