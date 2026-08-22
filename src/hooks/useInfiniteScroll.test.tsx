import { render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { flushIntersectionObservers } from '../test/setup'
import { useInfiniteScroll } from './useInfiniteScroll'

function Probe({ hasMore, onLoadMore }: { hasMore: boolean; onLoadMore: () => void }) {
  const { rootRef, sentinelRef } = useInfiniteScroll(hasMore, onLoadMore)
  return <div ref={rootRef}><div ref={sentinelRef} data-testid="sentinel" /></div>
}

describe('useInfiniteScroll', () => {
  it('loads more when the sentinel intersects and stays quiet when the list is complete', () => {
    const loadMore = vi.fn()
    const { rerender } = render(<Probe hasMore onLoadMore={loadMore} />)
    flushIntersectionObservers(true)
    expect(loadMore).toHaveBeenCalledTimes(1)

    rerender(<Probe hasMore={false} onLoadMore={loadMore} />)
    flushIntersectionObservers(true)
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('does nothing until a sentinel is mounted', () => {
    const loadMore = vi.fn()
    renderHook(() => useInfiniteScroll(true, loadMore))
    flushIntersectionObservers(true)
    expect(loadMore).not.toHaveBeenCalled()
  })
})
