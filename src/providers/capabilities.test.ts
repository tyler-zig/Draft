import { describe, expect, it } from 'vitest'
import { demoProvider, espnProvider, nflProvider, sleeperProvider, yahooProvider } from './index'

describe('draft provider capabilities', () => {
  it('keeps the scrape-only providers read-only', () => {
    expect(espnProvider.capabilities).toEqual({ draftPick: false, autoPick: false })
    expect(yahooProvider.capabilities).toEqual({ draftPick: false, autoPick: false })
    expect(nflProvider.capabilities).toEqual({ draftPick: false, autoPick: false })
    expect(espnProvider.makePick).toBeUndefined()
    expect(yahooProvider.makePick).toBeUndefined()
    expect(nflProvider.makePick).toBeUndefined()
  })

  it('lets Sleeper submit a pick the user confirmed', () => {
    expect(sleeperProvider.capabilities).toEqual({ draftPick: true, autoPick: false })
    expect(typeof sleeperProvider.makePick).toBe('function')
  })

  it('limits mutation support to demo drafting', () => {
    expect(demoProvider.capabilities).toEqual({ draftPick: true, autoPick: false })
  })

  // The room must never submit a pick on its own. Nothing gets `autoPick`
  // until someone decides that is a feature and says so here.
  it('leaves every provider off autopick', () => {
    for (const provider of [demoProvider, sleeperProvider, espnProvider, yahooProvider, nflProvider]) {
      expect(provider.capabilities.autoPick).toBe(false)
    }
  })
})
