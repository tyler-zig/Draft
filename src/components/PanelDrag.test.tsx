import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PanelResizeHandles } from './PanelResizeHandles'
import { loadPanelLayout, usePanelLayout } from '../hooks/usePanelLayout'

/** A stand-in for the real panels: same hook, same wiring, no page around it. */
function Panel({ layoutKey = 'demo-panel' }: { layoutKey?: string }) {
  const { panelRef, style, dragHandleProps, resizeHandleProps, reset, moved } = usePanelLayout(layoutKey)
  return <section ref={panelRef as React.Ref<HTMLElement>} style={style} data-testid="panel" data-moved={moved}>
    <PanelResizeHandles resizeHandleProps={resizeHandleProps} />
    <header data-testid="handle" {...dragHandleProps}>
      <h2>Panel</h2>
      <button type="button" onClick={reset}>Reset</button>
    </header>
  </section>
}

function drag(target: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] })
  fireEvent.pointerMove(target, { pointerId: 1, clientX: to[0], clientY: to[1] })
  fireEvent.pointerUp(target, { pointerId: 1, clientX: to[0], clientY: to[1] })
}

afterEach(() => { localStorage.clear() })

describe('draggable panels', () => {
  it('starts unpositioned so the stylesheet keeps control until you drag', () => {
    render(<Panel />)
    expect(screen.getByTestId('panel')).not.toHaveStyle({ position: 'fixed' })
    expect(screen.getByTestId('panel').dataset.moved).toBe('false')
  })

  it('moves by the drag delta and saves where it was left', () => {
    render(<Panel />)
    drag(screen.getByTestId('handle'), [500, 400], [560, 450])
    const panel = screen.getByTestId('panel')
    expect(panel).toHaveStyle({ position: 'fixed' })
    const saved = loadPanelLayout('demo-panel')
    expect(saved).not.toBeNull()
    // jsdom reports a zero-size box, so the delta is what can be asserted.
    expect(saved!.x).toBe(60)
    expect(saved!.y).toBe(50)
  })

  it('restores the saved layout on the next mount', () => {
    const { unmount } = render(<Panel />)
    drag(screen.getByTestId('handle'), [500, 400], [600, 500])
    unmount()
    render(<Panel />)
    expect(screen.getByTestId('panel')).toHaveStyle({ position: 'fixed', left: '100px', top: '100px' })
  })

  it('resizes from a corner handle', () => {
    const { container } = render(<Panel />)
    drag(container.querySelector('.cc-resize-se')!, [0, 0], [200, 120])
    // Width and height floor at the minimum grabbable size in a zero-box jsdom.
    const saved = loadPanelLayout('demo-panel')
    expect(saved!.w).toBeGreaterThanOrEqual(360)
    expect(saved!.h).toBeGreaterThanOrEqual(240)
  })

  it('forgets the layout on reset', () => {
    render(<Panel />)
    drag(screen.getByTestId('handle'), [500, 400], [600, 500])
    expect(loadPanelLayout('demo-panel')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(loadPanelLayout('demo-panel')).toBeNull()
    expect(screen.getByTestId('panel')).not.toHaveStyle({ position: 'fixed' })
  })

  it('resets on a double-click of the handle', () => {
    render(<Panel />)
    drag(screen.getByTestId('handle'), [500, 400], [600, 500])
    fireEvent.doubleClick(screen.getByTestId('handle'))
    expect(loadPanelLayout('demo-panel')).toBeNull()
  })

  // Clicking Close or any other header control must not start a drag.
  it('ignores a drag started on a control inside the handle', () => {
    render(<Panel />)
    const button = screen.getByRole('button', { name: 'Reset' })
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(screen.getByTestId('handle'), { pointerId: 1, clientX: 200, clientY: 200 })
    expect(screen.getByTestId('panel')).not.toHaveStyle({ position: 'fixed' })
  })

  it('ignores a right-click drag', () => {
    render(<Panel />)
    fireEvent.pointerDown(screen.getByTestId('handle'), { button: 2, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(screen.getByTestId('handle'), { pointerId: 1, clientX: 200, clientY: 200 })
    expect(screen.getByTestId('panel')).not.toHaveStyle({ position: 'fixed' })
  })

  it('gives each panel its own remembered geometry', () => {
    const { unmount } = render(<Panel layoutKey="board" />)
    drag(screen.getByTestId('handle'), [0, 0], [30, 40])
    unmount()
    render(<Panel layoutKey="sheet" />)
    expect(loadPanelLayout('board')).toMatchObject({ x: 30, y: 40 })
    expect(loadPanelLayout('sheet')).toBeNull()
  })
})
