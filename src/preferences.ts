export type AppTheme = 'dark' | 'light'
export type TableColumnKey = 'rank' | 'player' | 'position' | 'team' | 'tier' | 'adp' | 'liveAdp' | 'liveAdp1d' | 'liveAdp7d' | 'projection' | 'vorp' | 'value' | 'sos'

/**
 * The board before vs 1d / vs 7d existed. A saved copy of this exact set is
 * treated as the old default so those two columns land next to Live ADP
 * without undoing a customized list.
 */
const PRE_LIVE_ADP_CHANGE_COLUMNS: TableColumnKey[] = [
  'rank', 'player', 'position', 'team', 'tier', 'adp', 'liveAdp', 'projection', 'vorp', 'value', 'sos',
]

export const TABLE_COLUMNS: Array<{ key: TableColumnKey; label: string; required?: boolean; hint?: string; compact?: boolean }> = [
  { key: 'rank', label: 'Rank' },
  { key: 'player', label: 'Player', required: true },
  { key: 'position', label: 'Pos' },
  { key: 'team', label: 'Team' },
  { key: 'tier', label: 'Tier' },
  { key: 'adp', label: 'ADP' },
  {
    key: 'liveAdp',
    label: 'Live ADP',
    compact: true,
    hint: "FantasyPros Real-Time ADP for this league's scoring (the number on fantasypros.com/nfl/real-time-adp/). Falls back to Draft Wizard mock-draft ADP for league size when that board is missing. Checked every 15 minutes. Blank when the player is not on the board.",
  },
  {
    key: 'liveAdp1d',
    label: 'vs 1d',
    compact: true,
    hint: "FantasyPros Last 1 rolling ADP minus current Live ADP. Positive means the player is being drafted earlier than yesterday's market. Blank when the live board has no Last 1 window.",
  },
  {
    key: 'liveAdp7d',
    label: 'vs 7d',
    compact: true,
    hint: "FantasyPros Last 7 rolling ADP minus current Live ADP. Positive means the player is being drafted earlier than last week's market. Blank when the live board has no Last 7 window.",
  },
  {
    key: 'projection',
    label: 'Proj',
    hint: "Consensus season projection (CBS, ESPN, FantasySharks, and RotoWire via Sleeper) scored to this league's format. Blank when no source has published a row.",
  },
  {
    key: 'vorp',
    label: 'VORP',
    hint: "Points above a replacement-level player at the same position, using the consensus season projection. Blank when no projection is published.",
  },
  {
    key: 'value',
    label: 'Value',
    hint: 'Current pick minus live ADP (season ADP only if the live board has no row). Positive means the player has fallen past his market slot; negative means you would be reaching.',
  },
  {
    key: 'sos',
    label: 'SoS',
    hint: "Strength of schedule over the window that matters: the league's playoff weeks in H2H (15–17 when it does not report them), or weeks 1–4 in chopped / last-man-standing. 1 = easiest slate among teams that play in the window. Blank when the matchup model is unavailable.",
  },
]

const THEME_KEY = 'draft-assistant:theme'
const COLUMNS_KEY = 'draft-assistant:table-columns'
const SOUNDS_KEY = 'draft-assistant:draft-sounds'

export function loadTheme(): AppTheme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
}

export function saveTheme(theme: AppTheme) {
  localStorage.setItem(THEME_KEY, theme)
  document.documentElement.dataset.theme = theme
  void mirrorPreferences()
}

export function applyStoredTheme() {
  document.documentElement.dataset.theme = loadTheme()
}

function withLiveAdpChangeColumns(selected: TableColumnKey[]): TableColumnKey[] {
  if (selected.includes('liveAdp1d') || selected.includes('liveAdp7d')) return selected
  const isLegacyDefault = selected.length === PRE_LIVE_ADP_CHANGE_COLUMNS.length
    && PRE_LIVE_ADP_CHANGE_COLUMNS.every((key) => selected.includes(key))
  if (!isLegacyDefault) return selected
  const at = selected.indexOf('liveAdp')
  return [...selected.slice(0, at + 1), 'liveAdp1d', 'liveAdp7d', ...selected.slice(at + 1)]
}

export function loadTableColumns(): TableColumnKey[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null') as unknown
    if (!Array.isArray(parsed)) return TABLE_COLUMNS.map((column) => column.key)
    const allowed = new Set(TABLE_COLUMNS.map((column) => column.key))
    const selected = parsed.filter((key): key is TableColumnKey => typeof key === 'string' && allowed.has(key as TableColumnKey))
    if (!selected.includes('player')) selected.push('player')
    return selected.length ? withLiveAdpChangeColumns(selected) : TABLE_COLUMNS.map((column) => column.key)
  } catch {
    return TABLE_COLUMNS.map((column) => column.key)
  }
}

export function saveTableColumns(columns: TableColumnKey[]) {
  localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns))
  void mirrorPreferences()
}

export function loadDraftSounds(): boolean {
  return localStorage.getItem(SOUNDS_KEY) !== '0'
}

export function saveDraftSounds(enabled: boolean) {
  localStorage.setItem(SOUNDS_KEY, enabled ? '1' : '0')
}
import { mirrorPreferences } from './supabase/cloudStore'
