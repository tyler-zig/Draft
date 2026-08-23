import { beforeEach, describe, expect, it } from 'vitest'
import { applyStoredTheme, loadDraftSounds, loadTableColumns, loadTheme, saveDraftSounds, saveTableColumns, saveTheme } from './preferences'

describe('persisted preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('persists and reapplies the selected theme', () => {
    saveTheme('light')
    expect(loadTheme()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    delete document.documentElement.dataset.theme
    applyStoredTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('persists columns while always retaining Player', () => {
    saveTableColumns(['rank', 'player', 'team'])
    expect(loadTableColumns()).toEqual(['rank', 'player', 'team'])
    localStorage.setItem('draft-assistant:table-columns', JSON.stringify(['rank']))
    expect(loadTableColumns()).toEqual(['rank', 'player'])
  })

  it('accepts the Live ADP column and drops keys that are no longer columns', () => {
    localStorage.setItem('draft-assistant:table-columns', JSON.stringify(['liveAdp', 'player', 'stale-key']))
    expect(loadTableColumns()).toEqual(['liveAdp', 'player'])
  })

  it('inserts vs 1d / vs 7d after Live ADP on the previous default board', () => {
    localStorage.setItem('draft-assistant:table-columns', JSON.stringify([
      'rank', 'player', 'position', 'team', 'tier', 'adp', 'liveAdp', 'projection', 'vorp', 'value', 'sos',
    ]))
    expect(loadTableColumns()).toEqual([
      'rank', 'player', 'position', 'team', 'tier', 'adp', 'liveAdp', 'liveAdp1d', 'liveAdp7d', 'projection', 'vorp', 'value', 'sos',
    ])
  })

  it('leaves a customized board without the change columns alone', () => {
    saveTableColumns(['rank', 'player', 'liveAdp', 'vorp'])
    expect(loadTableColumns()).toEqual(['rank', 'player', 'liveAdp', 'vorp'])
  })

  it('defaults draft sounds on and persists a mute', () => {
    expect(loadDraftSounds()).toBe(true)
    saveDraftSounds(false)
    expect(loadDraftSounds()).toBe(false)
  })
})
