import { idbGet, idbSet } from '../api/playerCache'
import type { RankSet, RankSettings } from './types'
import { RANK_SETS_KEY, RANK_SETTINGS_KEY } from './types'
import { mirrorPreferences, mirrorRankingSets } from '../supabase/cloudStore'

const DEFAULT_SETTINGS: RankSettings = {
  enabledIds: ['builtin:sleeper'],
  method: 'median',
}

export async function loadImportedSets(): Promise<RankSet[]> {
  return (await idbGet<RankSet[]>(RANK_SETS_KEY)) ?? []
}

export async function saveImportedSets(sets: RankSet[]): Promise<void> {
  await idbSet(RANK_SETS_KEY, sets)
  await mirrorRankingSets(sets)
}

export function loadRankSettings(): RankSettings {
  try {
    const raw = localStorage.getItem(RANK_SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as RankSettings
    if (!Array.isArray(parsed.enabledIds)) return DEFAULT_SETTINGS
    return {
      enabledIds: parsed.enabledIds,
      method: parsed.method === 'mean' ? 'mean' : 'median',
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveRankSettings(settings: RankSettings) {
  localStorage.setItem(RANK_SETTINGS_KEY, JSON.stringify(settings))
  void mirrorPreferences()
}
