import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A remembered position and size for a draggable, resizable panel.
 *
 * Stored per panel key so the player sheet and the full board keep their own
 * geometry. Coordinates are viewport pixels from the top-left.
 */
export interface PanelLayout {
  x: number
  y: number
  w: number
  h: number
}

const STORAGE_PREFIX = 'draft-assistant:panel:'

/** Never let a panel get so small it cannot be grabbed and moved again. */
const MIN_W = 360
const MIN_H = 240
/** Keep this much of the panel on screen so the drag handle stays reachable. */
const EDGE_KEEP = 80

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`
}

function isLayout(value: unknown): value is PanelLayout {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PanelLayout>
  return (['x', 'y', 'w', 'h'] as const).every(
    (field) => typeof item[field] === 'number' && Number.isFinite(item[field]),
  )
}

export function loadPanelLayout(key: string): PanelLayout | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null') as unknown
    return isLayout(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function savePanelLayout(key: string, layout: PanelLayout) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(layout))
  } catch {
    /* a panel that cannot be remembered still opens at its default */
  }
}

export function clearPanelLayout(key: string) {
  try {
    localStorage.removeItem(storageKey(key))
  } catch {
    /* already gone as far as this session is concerned */
  }
}

/**
 * Fits a remembered layout to the window it is being restored into.
 *
 * A panel saved on a 34" monitor must not open off-screen on a laptop, and one
 * dragged to the right edge must not strand its header past the viewport.
 * Exported so the behaviour can be tested without a DOM.
 */
export function clampLayout(layout: PanelLayout, viewportW: number, viewportH: number): PanelLayout {
  const w = Math.max(MIN_W, Math.min(layout.w, viewportW))
  const h = Math.max(MIN_H, Math.min(layout.h, viewportH))
  return {
    w,
    h,
    x: Math.round(Math.min(Math.max(layout.x, EDGE_KEEP - w), viewportW - EDGE_KEEP)),
    y: Math.round(Math.min(Math.max(layout.y, 0), Math.max(0, viewportH - EDGE_KEEP))),
  }
}

/**
 * Makes a panel draggable by its header and resizable from its edges, and
 * remembers where it was left.
 *
 * Returns `null` for `layout` until the user has moved or resized the panel --
 * an untouched panel keeps its CSS-centred default rather than being pinned to
 * a JS-computed position, so the responsive rules in the stylesheet stay in
 * charge for everyone who never drags anything.
 */
export function usePanelLayout(key: string) {
  const panelRef = useRef<HTMLElement | null>(null)
  // Fitted as it is read, not in an effect: a layout saved on a different
  // window size must never be painted at its stored geometry first.
  const [layout, setLayout] = useState<PanelLayout | null>(() => {
    const saved = loadPanelLayout(key)
    return saved ? clampLayout(saved, window.innerWidth, window.innerHeight) : null
  })
  const gesture = useRef<{
    mode: 'move' | 'resize'
    edge: string
    pointerId: number
    startX: number
    startY: number
    origin: PanelLayout
  } | null>(null)

  useEffect(() => {
    if (!layout) return
    const onResize = () => {
      setLayout((current) => (current ? clampLayout(current, window.innerWidth, window.innerHeight) : current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [layout])

  /** The panel's live geometry, so a first drag starts from wherever CSS put it. */
  const measure = useCallback((): PanelLayout | null => {
    const node = panelRef.current
    if (!node) return null
    const box = node.getBoundingClientRect()
    return { x: box.left, y: box.top, w: box.width, h: box.height }
  }, [])

  const begin = useCallback((mode: 'move' | 'resize', edge: string) => (event: React.PointerEvent) => {
    // Left button only, and never from a control inside the header.
    if (event.button !== 0) return
    if (mode === 'move' && (event.target as HTMLElement).closest('button, a, input, select, textarea')) return
    const origin = layout ?? measure()
    if (!origin) return
    event.preventDefault()
    gesture.current = {
      mode,
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    setLayout(origin)
  }, [layout, measure])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    const { x, y, w, h } = active.origin
    const next = active.mode === 'move'
      ? { x: x + dx, y: y + dy, w, h }
      : {
          x: active.edge.includes('w') ? x + dx : x,
          y: active.edge.includes('n') ? y + dy : y,
          w: active.edge.includes('e') ? w + dx : active.edge.includes('w') ? w - dx : w,
          h: active.edge.includes('s') ? h + dy : active.edge.includes('n') ? h - dy : h,
        }
    // A resize that would go under the minimum must pin the moving edge rather
    // than let the opposite edge crawl away from the pointer.
    if (next.w < MIN_W) {
      if (active.edge.includes('w')) next.x = x + (w - MIN_W)
      next.w = MIN_W
    }
    if (next.h < MIN_H) {
      if (active.edge.includes('n')) next.y = y + (h - MIN_H)
      next.h = MIN_H
    }
    setLayout(clampLayout(next, window.innerWidth, window.innerHeight))
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    gesture.current = null
    ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
    setLayout((current) => {
      if (current) savePanelLayout(key, current)
      return current
    })
  }, [key])

  const reset = useCallback(() => {
    gesture.current = null
    clearPanelLayout(key)
    setLayout(null)
  }, [key])

  const dragHandleProps = {
    onPointerDown: begin('move', ''),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    // Double-clicking a title bar to restore the default size is the
    // convention everywhere else, and it is the only way back for someone who
    // has dragged the panel somewhere useless.
    onDoubleClick: reset,
  }

  const resizeHandleProps = (edge: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw') => ({
    onPointerDown: begin('resize', edge),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  })

  const style: React.CSSProperties | undefined = layout
    ? {
        position: 'fixed',
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
        maxWidth: 'none',
        maxHeight: 'none',
        margin: 0,
      }
    : undefined

  return { panelRef, style, dragHandleProps, resizeHandleProps, reset, moved: layout != null }
}
