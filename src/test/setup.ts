import '@testing-library/jest-dom/vitest'
import { act, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

type Observed = { callback: IntersectionObserverCallback }

const observers = new Set<Observed>()

class IntersectionObserverStub implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = ''
  readonly scrollMargin = ''
  readonly thresholds: ReadonlyArray<number> = []
  readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.root = options?.root ?? null
    observers.add(this)
  }

  observe() {}
  unobserve() {}
  disconnect() { observers.delete(this) }
  takeRecords(): IntersectionObserverEntry[] { return [] }
}

globalThis.IntersectionObserver = IntersectionObserverStub

/** Fire every mounted observer. Used to page infinite lists in tests. */
export function flushIntersectionObservers(isIntersecting = true) {
  const entry = {
    isIntersecting,
    intersectionRatio: isIntersecting ? 1 : 0,
    target: document.body,
    time: 0,
    boundingClientRect: document.body.getBoundingClientRect(),
    intersectionRect: document.body.getBoundingClientRect(),
    rootBounds: null,
  } as IntersectionObserverEntry
  act(() => {
    for (const observer of [...observers]) {
      observer.callback([entry], observer as unknown as IntersectionObserver)
    }
  })
}

afterEach(() => {
  observers.clear()
  cleanup()
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
