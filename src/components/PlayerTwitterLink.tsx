import { useQuery } from '@tanstack/react-query'
import type { Player } from '../providers/types'
import { loadTwitterCatalog, twitterHandleFor, twitterUrl } from '../api/playerTwitter'

export const twitterCatalogQuery = {
  queryKey: ['player-twitter-catalog'] as const,
  queryFn: ({ signal }: { signal?: AbortSignal }) => loadTwitterCatalog(signal),
  staleTime: 86_400_000,
  retry: false as const,
}

export function PlayerTwitterLink({ player, className = 'pd-x' }: { player: Player; className?: string }) {
  const catalog = useQuery(twitterCatalogQuery)
  const handle = twitterHandleFor(player, catalog.data)
  if (!handle) return null
  return <span><a className={className} href={twitterUrl(handle)} target="_blank" rel="noreferrer" aria-label={`${player.fullName} on X`}>@{handle}</a></span>
}
