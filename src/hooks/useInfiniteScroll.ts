import { useEffect, useRef } from 'react'

/**
 * Observes a sentinel at the end of a scrollable list. When it enters the
 * container (including when the first page is too short to scroll), `loadMore`
 * runs. Re-observes after each load so a still-visible sentinel keeps paging.
 */
export function useInfiniteScroll(hasMore: boolean, loadMore: () => void, pageKey = 0) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasMore) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { root: rootRef.current, rootMargin: '200px 0px', threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore, pageKey])

  return { rootRef, sentinelRef }
}
