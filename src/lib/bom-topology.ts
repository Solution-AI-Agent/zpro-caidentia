import { bomPath, visibleBomNodes, type indexBom } from "../shared/bom";

export interface BomBox {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  open: boolean;
  omitted: number;
}

// Logical containment, not physical dimensions or quantities. Parent-first output.
export function layoutBomTopology(
  index: ReturnType<typeof indexBom>,
  expanded: Set<string>,
  depth = 5,
  selected = "",
  limit = 200,
) {
  const visible = visibleBomNodes(index, expanded).filter(
    (n) => n.level <= depth,
  );
  const visibleIds = new Set(visible.map((n) => n.occurrence));
  // Reserve the visible selection path before filling the canvas budget.
  const allowed = new Set(
    bomPath(index.nodes, selected)
      .map((n) => n.occurrence)
      .filter((id) => visibleIds.has(id))
      .slice(0, limit),
  );
  for (const n of visible) {
    if (allowed.size >= limit) break;
    if (!n.parent || allowed.has(n.parent)) allowed.add(n.occurrence);
  }
  const boxes = new Map<string, BomBox>();
  const gap = 12,
    pad = 14;
  function measure(id: string): BomBox {
    const n = index.nodes.get(id)!;
    const children = n.children
      .filter((child) => allowed.has(child))
      .map(measure);
    const box: BomBox = {
      id,
      parentId: n.parent || undefined,
      position: { x: 0, y: 0 },
      width: 184,
      height: 100,
      open: children.length > 0,
      omitted:
        expanded.has(id) && n.level < depth
          ? n.children.length - children.length
          : 0,
    };
    if (children.length) {
      const columns = Math.min(children.length, children.length === 3 ? 3 : 2);
      const widths = Array.from({ length: columns }, (_, col) =>
        Math.max(
          ...children.filter((_, i) => i % columns === col).map((c) => c.width),
        ),
      );
      // Reserve a toolbar lane above leaves. Columns pack independently so
      // a deep assembly does not leave large blank rows beside simple parts.
      const header = children.every(
        (c) => !index.nodes.get(c.id)!.children.length,
      )
        ? 74
        : 44;
      const heights = widths.map(() => header);
      children.forEach((child, i) => {
        const col = i % columns;
        child.position = {
          x: pad + widths.slice(0, col).reduce((sum, w) => sum + w + gap, 0),
          y: heights[col],
        };
        heights[col] += child.height + gap;
      });
      box.width =
        widths.reduce((sum, w) => sum + w, 0) + gap * (columns - 1) + pad * 2;
      box.height = Math.max(...heights) - gap + pad + (box.omitted ? 24 : 0);
    }
    boxes.set(id, box);
    return box;
  }
  let x = 0;
  for (const id of index.roots.filter((id) => allowed.has(id))) {
    const root = measure(id);
    root.position = { x, y: 0 };
    x += root.width + 32;
  }
  return {
    boxes: visible
      .filter((n) => allowed.has(n.occurrence))
      .map((n) => boxes.get(n.occurrence)!),
    omitted: visible.length - allowed.size,
  };
}
