import { LIVE_ADP_MAX_AGE_MS, type LiveAdpSnapshot } from './liveAdp'
import { isLiveAdpSetId } from './types'
import type { CollectedSnapshot } from './collected'

export type HostedSourceId =
  | 'fantasypros'
  | 'fantasypros-adp'
  | 'draftwizard-adp'
  | 'rotowire'
  | 'espn'

export interface HostedSource {
  id: HostedSourceId
  label: string
  detail: string
  fetchedAt: number | null
  boards: number
  present: boolean
  cadence: string
}

function setId(set: { id?: string } | null | undefined): string {
  return String(set?.id ?? '')
}

function countSets(sets: { id?: string }[] | undefined, match: (id: string) => boolean): number {
  return (sets ?? []).filter((set) => match(setId(set))).length
}

function hasEspnIds(snapshot: CollectedSnapshot | null | undefined): boolean {
  return Boolean(snapshot?.sets.some((set) => set.rows.some((row) => row.espnId)))
}

/**
 * Sources the hosted collector publishes. Real-Time ADP is always listed:
 * it lives on `adp-latest` (15-minute cron), not inside the 6-hour
 * rankings snapshot the page used to treat as the only source list.
 */
export function hostedCollectorSources(
  rankings: CollectedSnapshot | null | undefined,
  adp: LiveAdpSnapshot | null | undefined,
): HostedSource[] {
  const rankingSets = rankings?.sets ?? []
  const adpSets = adp?.sets ?? []

  const fantasyPros = countSets(rankingSets, (id) => id.startsWith('fantasypros-') && !isLiveAdpSetId(id))
  const realTime = countSets(adpSets, (id) => id.startsWith('fantasypros-rtadp'))
    || countSets(rankingSets, (id) => id.startsWith('fantasypros-rtadp'))
  const draftWizard = countSets(adpSets, (id) => id.startsWith('draftwizard-adp-'))
    || countSets(rankingSets, (id) => id.startsWith('draftwizard-adp-'))
  const rotowire = countSets(rankingSets, (id) => id.startsWith('rotowire-'))
  const espn = hasEspnIds(rankings)

  const adpAt = adp?.fetchedAt && adp.fetchedAt > 0 ? adp.fetchedAt : null
  const rankingsAt = rankings?.fetchedAt && rankings.fetchedAt > 0 ? rankings.fetchedAt : null
  const liveAt = realTime ? adpAt ?? rankingsAt : null

  return [
    {
      id: 'fantasypros',
      label: 'FantasyPros',
      detail: fantasyPros ? `${fantasyPros} ECR boards · hosted every 6 hours` : 'Hosted every 6 hours · not published yet',
      fetchedAt: fantasyPros ? rankingsAt : null,
      boards: fantasyPros,
      present: fantasyPros > 0,
      cadence: 'every 6 hours',
    },
    {
      id: 'fantasypros-adp',
      label: 'FantasyPros Real-Time ADP',
      detail: realTime
        ? `${realTime} format boards · hosted every 15 minutes`
        : 'Hosted every 15 minutes · not published yet',
      fetchedAt: liveAt,
      boards: realTime,
      present: realTime > 0,
      cadence: 'every 15 minutes',
    },
    {
      id: 'draftwizard-adp',
      label: 'Draft Wizard ADP',
      detail: draftWizard
        ? `${draftWizard} size × scoring boards · league-size fallback`
        : 'League-size fallback · not published yet',
      fetchedAt: draftWizard ? adpAt ?? rankingsAt : null,
      boards: draftWizard,
      present: draftWizard > 0,
      cadence: 'with live ADP',
    },
    {
      id: 'rotowire',
      label: 'RotoWire',
      detail: rotowire ? `${rotowire} board${rotowire === 1 ? '' : 's'} · hosted every 6 hours` : 'Hosted every 6 hours · not published yet',
      fetchedAt: rotowire ? rankingsAt : null,
      boards: rotowire,
      present: rotowire > 0,
      cadence: 'every 6 hours',
    },
    {
      id: 'espn',
      label: 'ESPN crosswalk',
      detail: espn ? 'Player IDs attached on the hosted snapshot' : 'Hosted every 6 hours · not published yet',
      fetchedAt: espn ? rankingsAt : null,
      boards: espn ? 1 : 0,
      present: espn,
      cadence: 'every 6 hours',
    },
  ]
}

export function relativeAge(timestamp: number | null | undefined, now = Date.now()): string {
  if (timestamp == null || !(timestamp > 0)) return '—'
  const seconds = Math.round((now - timestamp) / 1000)
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Expert boards are on a 6-hour job; two missed runs is stale. */
export const HOSTED_BOARDS_STALE_MS = 12 * 60 * 60 * 1000

export function hostedFreshness(
  source: Pick<HostedSource, 'id' | 'present' | 'fetchedAt'>,
  now = Date.now(),
): 'live' | 'stale' | 'off' {
  if (!source.present || source.fetchedAt == null) return 'off'
  const limit = source.id === 'fantasypros-adp' || source.id === 'draftwizard-adp'
    ? LIVE_ADP_MAX_AGE_MS
    : HOSTED_BOARDS_STALE_MS
  return now - source.fetchedAt > limit ? 'stale' : 'live'
}
