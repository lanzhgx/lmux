import type { LayoutNode, PaneNode, SplitNode } from '../../shared/types'

/** Flatten a layout tree to its leaf panes (used for cleanup / iteration). */
export function collectPanes(node: LayoutNode): PaneNode[] {
  if (node.type === 'pane') return [node]
  return node.children.flatMap(collectPanes)
}

/** Map every leaf pane through `fn`, preserving node identity where unchanged. */
export function mapPanes(node: LayoutNode, fn: (p: PaneNode) => PaneNode): LayoutNode {
  if (node.type === 'pane') return fn(node)
  let changed = false
  const children = node.children.map((c) => {
    const nc = mapPanes(c, fn)
    if (nc !== c) changed = true
    return nc
  })
  return changed ? { ...node, children } : node
}

/** Patch the pane with id `paneId` (e.g. set its startupCommand). */
export function updatePane(node: LayoutNode, paneId: string, patch: Partial<PaneNode>): LayoutNode {
  return mapPanes(node, (p) => (p.id === paneId ? { ...p, ...patch } : p))
}

/** Replace the pane `paneId` with a split of [existingPane, newPane]. */
export function splitPaneInTree(
  node: LayoutNode,
  paneId: string,
  orientation: SplitNode['orientation'],
  newPane: PaneNode
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== paneId) return node
    return { type: 'split', orientation, ratios: [0.5, 0.5], children: [node, newPane] }
  }
  return { ...node, children: node.children.map((c) => splitPaneInTree(c, paneId, orientation, newPane)) }
}

/**
 * Remove pane `paneId`. Collapses a split down to its sole survivor, and preserves
 * the remaining children's relative proportions. Returns null if the whole tree empties.
 */
export function removePaneFromTree(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') return node.id === paneId ? null : node
  const kept: { child: LayoutNode; ratio: number }[] = []
  node.children.forEach((c, i) => {
    const r = removePaneFromTree(c, paneId)
    if (r !== null) kept.push({ child: r, ratio: node.ratios[i] ?? 1 / node.children.length })
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0].child // collapse single-child split
  const total = kept.reduce((s, k) => s + k.ratio, 0) || 1
  return { ...node, children: kept.map((k) => k.child), ratios: kept.map((k) => k.ratio / total) }
}

/** Set the `ratios` of the split node located at `path` (array of child indices). */
export function setRatiosAtPath(node: LayoutNode, path: number[], ratios: number[]): LayoutNode {
  if (path.length === 0) {
    return node.type === 'split' ? { ...node, ratios } : node
  }
  if (node.type !== 'split') return node
  const [i, ...rest] = path
  return {
    ...node,
    children: node.children.map((c, idx) => (idx === i ? setRatiosAtPath(c, rest, ratios) : c))
  }
}
