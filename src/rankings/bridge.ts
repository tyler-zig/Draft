import type { RankRow } from './types'

export interface ScrapedRankings {
  label: string
  sourceUrl: string
  fetchedAt: number
  rows: RankRow[]
}

let latest: ScrapedRankings | null = null
const listeners = new Set<() => void>()

export function getScrapedRankings() { return latest }
export function subscribeScrapedRankings(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function ingestScrapedRankings(data: unknown) {
  if (!data || typeof data !== 'object') return
  const message = data as { source?: string; type?: string; payload?: ScrapedRankings | null }
  if (message.source !== 'draft-assistant-extension' || message.type !== 'RANKINGS_SNAPSHOT') return
  if (!message.payload || !Array.isArray(message.payload.rows)) return
  latest = message.payload
  for (const listener of listeners) listener()
}
