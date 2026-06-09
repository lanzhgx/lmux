import { Allotment } from 'allotment'
import type { Connection, LayoutNode } from '../../shared/types'
import { TerminalPane } from './TerminalPane'
import { useStore } from '../store'

/**
 * Renders a layout tree. Leaves are terminals; splits are draggable allotment
 * views. `path` is the chain of child indices from the root to this node, used to
 * persist a split's ratios after a drag.
 */
export function LayoutView({
  node,
  connection,
  active,
  wsId,
  tabId,
  path = []
}: {
  node: LayoutNode
  connection: Connection
  active: boolean
  wsId: string
  tabId: string
  path?: number[]
}): JSX.Element {
  const setRatios = useStore((s) => s.setRatios)

  if (node.type === 'pane') {
    return <TerminalPane pane={node} connection={connection} active={active} wsId={wsId} tabId={tabId} />
  }

  return (
    <div className="split-host">
      <Allotment
        vertical={node.orientation === 'vertical'}
        defaultSizes={node.children.map((_, i) => Math.round((node.ratios[i] ?? 1 / node.children.length) * 1000))}
        onDragEnd={(sizes) => {
          const total = sizes.reduce((a, b) => a + b, 0) || 1
          setRatios(wsId, tabId, path, sizes.map((s) => s / total))
        }}
      >
        {node.children.map((child, i) => (
          <Allotment.Pane key={child.type === 'pane' ? child.id : `s${i}`} minSize={90}>
            <LayoutView
              node={child}
              connection={connection}
              active={active}
              wsId={wsId}
              tabId={tabId}
              path={[...path, i]}
            />
          </Allotment.Pane>
        ))}
      </Allotment>
    </div>
  )
}
