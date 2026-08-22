import { idbGet, idbSet } from '../api/playerCache'
import { TABLE_COLUMNS, type AppTheme, type TableColumnKey } from '../preferences'
import type { KeeperEntry } from '../providers/types'
import { RANK_SETS_KEY, RANK_SETTINGS_KEY, type RankSet, type RankSettings } from '../rankings/types'
import { mergeSavedLeagues, savedLeagueKey, sortSavedLeagues, takeLegacySavedLeagues, type SavedLeague } from '../leagues/savedLeagues'
import { supabase } from './client'
import type { Json } from './database.types'

const THEME_KEY = 'draft-assistant:theme'
const COLUMNS_KEY = 'draft-assistant:table-columns'
const QUEUE_PREFIX = 'draft-assistant:queue:'
const KEEPERS_PREFIX = 'draft-assistant:keepers:'

function currentUserId() {
  return supabase?.auth.getUser().then(({ data }) => data.user?.id ?? null) ?? Promise.resolve(null)
}

function warn(operation: string, error: unknown) {
  console.warn(`[Supabase] ${operation} failed.`, error)
}

function json(value: unknown): Json {
  return value as Json
}

function parseArray<T>(value: string | null, valid: (item: unknown) => item is T): T[] {
  try {
    const parsed = JSON.parse(value ?? 'null') as unknown
    return Array.isArray(parsed) ? parsed.filter(valid) : []
  } catch {
    return []
  }
}

function localPreferences() {
  const theme: AppTheme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  const allowed = new Set(TABLE_COLUMNS.map((column) => column.key))
  const columns = parseArray(localStorage.getItem(COLUMNS_KEY), (value): value is TableColumnKey =>
    typeof value === 'string' && allowed.has(value as TableColumnKey),
  )
  let settings: RankSettings = { enabledIds: ['builtin:sleeper'], method: 'median' }
  try {
    const candidate = JSON.parse(localStorage.getItem(RANK_SETTINGS_KEY) ?? 'null') as Partial<RankSettings> | null
    if (candidate && Array.isArray(candidate.enabledIds)) {
      settings = { enabledIds: candidate.enabledIds.filter((id): id is string => typeof id === 'string'), method: candidate.method === 'mean' ? 'mean' : 'median' }
    }
  } catch { /* defaults */ }
  return { theme, columns: columns.length ? columns : TABLE_COLUMNS.map((column) => column.key), settings }
}

export async function mirrorPreferences(): Promise<void> {
  if (!supabase) return
  const userId = await currentUserId()
  if (!userId) return
  const local = localPreferences()
  const { error } = await supabase.from('user_preferences').upsert({
    user_id: userId,
    theme: local.theme,
    table_columns: json(local.columns),
    ranking_method: local.settings.method,
    enabled_ranking_ids: json(local.settings.enabledIds),
  })
  if (error) warn('preference sync', error)
}

function readDraftState(draftKey: string) {
  return {
    queue: parseArray(localStorage.getItem(QUEUE_PREFIX + draftKey) ?? sessionStorage.getItem(QUEUE_PREFIX + draftKey), (value): value is string => typeof value === 'string'),
    keepers: parseArray(localStorage.getItem(KEEPERS_PREFIX + draftKey), (value): value is KeeperEntry => {
      if (!value || typeof value !== 'object') return false
      const item = value as Partial<KeeperEntry>
      return typeof item.playerId === 'string' && typeof item.rosterId === 'string'
    }),
  }
}

export async function mirrorDraftState(draftKey: string): Promise<void> {
  if (!supabase) return
  const userId = await currentUserId()
  if (!userId) return
  const state = readDraftState(draftKey)
  const { error } = await supabase.from('draft_states').upsert({
    user_id: userId,
    draft_key: draftKey,
    queue_ids: json(state.queue),
    keepers: json(state.keepers),
  })
  if (error) warn('draft-state sync', error)
}

export async function mirrorRankingSets(sets: RankSet[]): Promise<void> {
  if (!supabase) return
  const userId = await currentUserId()
  if (!userId) return
  const { data: existing, error: readError } = await supabase.from('ranking_sets').select('set_id').eq('user_id', userId)
  if (readError) { warn('ranking-set lookup', readError); return }
  const ids = new Set(sets.map((set) => set.id))
  const removed = (existing ?? []).map((row) => row.set_id).filter((id) => !ids.has(id))
  if (removed.length) {
    const { error } = await supabase.from('ranking_sets').delete().eq('user_id', userId).in('set_id', removed)
    if (error) warn('ranking-set deletion', error)
  }
  if (sets.length) {
    const { error } = await supabase.from('ranking_sets').upsert(sets.map((set) => ({ user_id: userId, set_id: set.id, payload: json(set) })))
    if (error) warn('ranking-set sync', error)
  }
}

export async function saveProviderConnection(provider: 'sleeper' | 'espn' | 'yahoo' | 'nfl', externalUserId: string, displayName: string | null, lastLeagueId: string | null, metadata: Record<string, Json> = {}): Promise<void> {
  if (!supabase) return
  const userId = await currentUserId()
  if (!userId) return
  const { error } = await supabase.from('provider_connections').upsert({
    user_id: userId, provider, external_user_id: externalUserId, display_name: displayName,
    last_league_id: lastLeagueId, metadata,
  })
  if (error) warn('provider connection sync', error)
}

function rowToSavedLeague(row: {
  provider: string
  league_id: string
  season: string
  name: string
  draft_id: string | null
  external_user_id: string
  team_name: string | null
  scoring_type: string
  team_count: number
  last_opened_at: string
}): SavedLeague {
  return {
    provider: row.provider as SavedLeague['provider'],
    leagueId: row.league_id,
    season: row.season,
    name: row.name,
    draftId: row.draft_id,
    externalUserId: row.external_user_id,
    teamName: row.team_name,
    scoringType: row.scoring_type as SavedLeague['scoringType'],
    teamCount: row.team_count,
    lastOpenedAt: Date.parse(row.last_opened_at) || 0,
  }
}

export async function fetchSavedLeagues(): Promise<SavedLeague[]> {
  if (!supabase) return []
  const userId = await currentUserId()
  if (!userId) return []
  const { data, error } = await supabase.from('user_leagues').select('*').eq('user_id', userId)
  if (error) { warn('league lookup', error); return [] }
  return sortSavedLeagues((data ?? []).map(rowToSavedLeague))
}

/** Replaces the account's league list. A missing row is a real delete. */
export async function persistUserLeagues(leagues: SavedLeague[]): Promise<void> {
  if (!supabase) return
  const userId = await currentUserId()
  if (!userId) return
  const keys = new Set(leagues.map(savedLeagueKey))
  const { data: existing, error: readError } = await supabase
    .from('user_leagues').select('provider, league_id, season').eq('user_id', userId)
  if (readError) { warn('league lookup', readError); return }
  const removed = (existing ?? []).filter((row) => !keys.has(`${row.provider}:${row.league_id}:${row.season}`))
  for (const row of removed) {
    const { error } = await supabase.from('user_leagues').delete()
      .eq('user_id', userId).eq('provider', row.provider).eq('league_id', row.league_id).eq('season', row.season)
    if (error) warn('league deletion', error)
  }
  if (!leagues.length) return
  const { error } = await supabase.from('user_leagues').upsert(leagues.map((league) => ({
    user_id: userId,
    provider: league.provider,
    league_id: league.leagueId,
    season: league.season,
    name: league.name,
    draft_id: league.draftId,
    external_user_id: league.externalUserId,
    team_name: league.teamName,
    scoring_type: league.scoringType,
    team_count: league.teamCount,
    last_opened_at: new Date(league.lastOpenedAt).toISOString(),
  })))
  if (error) warn('league sync', error)
}

/** Loads account rows into the browser cache. Leftover device leagues import once. */
export async function hydrateCloudState(userId: string): Promise<void> {
  if (!supabase) return
  const [preferences, drafts, rankSets, leagues] = await Promise.all([
    supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('draft_states').select('*').eq('user_id', userId),
    supabase.from('ranking_sets').select('*').eq('user_id', userId),
    supabase.from('user_leagues').select('*').eq('user_id', userId),
  ])
  if (preferences.error) warn('preference hydration', preferences.error)
  if (drafts.error) warn('draft-state hydration', drafts.error)
  if (rankSets.error) warn('ranking-set hydration', rankSets.error)
  if (leagues.error) warn('league hydration', leagues.error)

  if (preferences.data) {
    localStorage.setItem(THEME_KEY, preferences.data.theme)
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(preferences.data.table_columns))
    localStorage.setItem(RANK_SETTINGS_KEY, JSON.stringify({
      method: preferences.data.ranking_method === 'mean' ? 'mean' : 'median',
      enabledIds: preferences.data.enabled_ranking_ids,
    }))
    document.documentElement.dataset.theme = preferences.data.theme
  } else if (!preferences.error) {
    await mirrorPreferences()
  }
  for (const state of drafts.data ?? []) {
    localStorage.setItem(QUEUE_PREFIX + state.draft_key, JSON.stringify(state.queue_ids))
    sessionStorage.setItem(QUEUE_PREFIX + state.draft_key, JSON.stringify(state.queue_ids))
    localStorage.setItem(KEEPERS_PREFIX + state.draft_key, JSON.stringify(state.keepers))
  }
  if (!drafts.error) {
    const cloudKeys = new Set((drafts.data ?? []).map((state) => state.draft_key))
    const localKeys = new Set<string>()
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key?.startsWith(QUEUE_PREFIX)) localKeys.add(key.slice(QUEUE_PREFIX.length))
        if (key?.startsWith(KEEPERS_PREFIX)) localKeys.add(key.slice(KEEPERS_PREFIX.length))
      }
    }
    await Promise.all([...localKeys].filter((key) => !cloudKeys.has(key)).map(mirrorDraftState))
  }
  if (rankSets.data?.length) {
    await idbSet(RANK_SETS_KEY, rankSets.data.map((row) => row.payload as unknown as RankSet))
  } else if (!rankSets.error) {
    await mirrorRankingSets((await idbGet<RankSet[]>(RANK_SETS_KEY)) ?? [])
  }
  if (!leagues.error) {
    const cloudRows = (leagues.data ?? []).map(rowToSavedLeague)
    const leftover = takeLegacySavedLeagues()
    if (leftover.length) await persistUserLeagues(mergeSavedLeagues(leftover, cloudRows))
  }
  window.dispatchEvent(new CustomEvent('draft-assistant:cloud-synced'))
}
