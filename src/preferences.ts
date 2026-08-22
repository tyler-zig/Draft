export type AppTheme = 'dark' | 'light'
export type TableColumnKey = 'rank' | 'player' | 'position' | 'team' | 'tier' | 'adp' | 'liveAdp' | 'projection' | 'vorp' | 'value' | 'sos'

export const TABLE_COLUMNS: Array<{ key: TableColumnKey; label: string; required?: boolean; hint?: string }> = [
  { key: 'rank', label: 'Rank' },
  { key: 'player', label: 'Player', required: true },
  { key: 'position', label: 'Pos' },
  { key: 'team', label: 'Team' },
  { key: 'tier', label: 'Tier' },
  { key: 'adp', label: 'ADP' },
  {
    key: 'liveAdp',
    label: 'Live ADP',
    hint: "FantasyPros Real-Time ADP for this league's scoring (the number on fantasypros.com/nfl/real-time-adp/). Falls back to Draft Wizard mock-draft ADP for league size when that board is missing. Checked every 15 minutes. Blank when the player is not on the board.",
  },
  {
    key: 'projection',
    label: 'Proj',
    hint: "RotoWire season projection via Sleeper, scored to this league's format. Blank when Sleeper has not published a row for the player.",
  },
  {
    key: 'vorp',
    label: 'VORP',
    hint: "Points above a replacement-level player at the same position, using that Sleeper/RotoWire season projection. Blank when no projection is published.",
  },
  {
    key: 'value',
    label: 'Value',
    hint: 'Current pick minus ADP. Positive means the player has fallen past his market slot; negative means you would be reaching.',
  },
  {
    key: 'sos',
    label: 'SoS',
    hint: "Strength of schedule over the league's playoff weeks only: average positional matchup rank of those opponents, 1 = easiest slate among teams that play in the window. Uses the league's reported playoff weeks (15–17 when it doesn't report them); blank when the matchup model is unavailable.",
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

export function loadTableColumns(): TableColumnKey[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null') as unknown
    if (!Array.isArray(parsed)) return TABLE_COLUMNS.map((column) => column.key)
    const allowed = new Set(TABLE_COLUMNS.map((column) => column.key))
    const selected = parsed.filter((key): key is TableColumnKey => typeof key === 'string' && allowed.has(key as TableColumnKey))
    if (!selected.includes('player')) selected.push('player')
    return selected.length ? selected : TABLE_COLUMNS.map((column) => column.key)
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
