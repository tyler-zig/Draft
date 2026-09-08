import { afterEach, describe, expect, it } from 'vitest'
import { clampLayout, clearPanelLayout, loadPanelLayout, savePanelLayout } from './usePanelLayout'

const KEY = 'test-panel'

afterEach(() => {
  localStorage.clear()
})

describe('panel layout storage', () => {
  it('round-trips a layout', () => {
    savePanelLayout(KEY, { x: 40, y: 60, w: 900, h: 600 })
    expect(loadPanelLayout(KEY)).toEqual({ x: 40, y: 60, w: 900, h: 600 })
  })

  it('keeps panels apart by key', () => {
    savePanelLayout('a', { x: 1, y: 2, w: 400, h: 300 })
    savePanelLayout('b', { x: 9, y: 8, w: 500, h: 400 })
    expect(loadPanelLayout('a')).toMatchObject({ x: 1 })
    expect(loadPanelLayout('b')).toMatchObject({ x: 9 })
  })

  it('clears a layout', () => {
    savePanelLayout(KEY, { x: 40, y: 60, w: 900, h: 600 })
    clearPanelLayout(KEY)
    expect(loadPanelLayout(KEY)).toBeNull()
  })

  // Anything half-written or hand-edited must fall back to the CSS default
  // rather than positioning a panel at NaN.
  it('rejects a malformed or partial layout', () => {
    for (const bad of ['null', '{}', '{"x":1,"y":2,"w":3}', '{"x":"40","y":0,"w":9,"h":9}', 'not json', '[]']) {
      localStorage.setItem(`draft-assistant:panel:${KEY}`, bad)
      expect(loadPanelLayout(KEY)).toBeNull()
    }
  })

  it('rejects non-finite numbers', () => {
    localStorage.setItem(`draft-assistant:panel:${KEY}`, JSON.stringify({ x: null, y: 0, w: 500, h: 400 }))
    expect(loadPanelLayout(KEY)).toBeNull()
  })
})

describe('clampLayout', () => {
  it('leaves a layout that already fits alone', () => {
    expect(clampLayout({ x: 100, y: 80, w: 900, h: 600 }, 1600, 900))
      .toEqual({ x: 100, y: 80, w: 900, h: 600 })
  })

  // Saved on a 34" monitor, reopened on a laptop.
  it('shrinks a panel bigger than the window', () => {
    const fitted = clampLayout({ x: 0, y: 0, w: 2400, h: 1400 }, 1280, 800)
    expect(fitted.w).toBe(1280)
    expect(fitted.h).toBe(800)
  })

  it('never shrinks below the minimum grabbable size', () => {
    const fitted = clampLayout({ x: 10, y: 10, w: 20, h: 20 }, 1600, 900)
    expect(fitted.w).toBe(360)
    expect(fitted.h).toBe(240)
  })

  // Dragged off the right edge on a wide screen: enough must stay on screen
  // that the header is still there to drag back.
  it('pulls a panel dragged past the right edge back into reach', () => {
    const fitted = clampLayout({ x: 5000, y: 40, w: 900, h: 600 }, 1280, 800)
    expect(fitted.x).toBeLessThanOrEqual(1280 - 80)
  })

  it('keeps a panel dragged off the left edge partly visible', () => {
    const fitted = clampLayout({ x: -5000, y: 40, w: 900, h: 600 }, 1280, 800)
    expect(fitted.x + 900).toBeGreaterThanOrEqual(80)
  })

  // The title bar is the only way to move a panel, so it may never go above
  // the top of the window.
  it('never lets the header go above the viewport', () => {
    expect(clampLayout({ x: 100, y: -400, w: 900, h: 600 }, 1280, 800).y).toBe(0)
  })

  it('keeps the header on screen at the bottom', () => {
    const fitted = clampLayout({ x: 100, y: 4000, w: 900, h: 600 }, 1280, 800)
    expect(fitted.y).toBeLessThanOrEqual(800 - 80)
  })

  it('returns whole pixels', () => {
    const fitted = clampLayout({ x: 10.4, y: 20.7, w: 900, h: 600 }, 1280, 800)
    expect(Number.isInteger(fitted.x)).toBe(true)
    expect(Number.isInteger(fitted.y)).toBe(true)
  })
})
