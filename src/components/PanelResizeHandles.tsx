import type { usePanelLayout } from '../hooks/usePanelLayout'

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const

/**
 * The eight drag targets around a resizable panel.
 *
 * Presentational and inert to assistive tech: resizing is a pointer
 * convenience, and the panel is fully usable at its default size without it.
 */
export function PanelResizeHandles({
  resizeHandleProps,
}: {
  resizeHandleProps: ReturnType<typeof usePanelLayout>['resizeHandleProps']
}) {
  return <>
    {EDGES.map((edge) => (
      <span key={edge} className={`cc-resize cc-resize-${edge}`} aria-hidden="true" {...resizeHandleProps(edge)} />
    ))}
  </>
}
