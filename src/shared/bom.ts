import type { BomRow } from "./model.js";

export const MAX_BOM_LEVEL = 5;
export type BomNode = BomRow & {
  level: number;
  children: string[];
  quantityPerRoot: number | null;
};

// Occurrences, not part numbers, identify a position in the assembly.
export function indexBom(rows: BomRow[]) {
  const nodes = new Map<string, BomNode>();
  const errors: Array<{ row: number; field: string; message: string }> = [];
  rows.forEach((row, i) => {
    if (nodes.has(row.occurrence))
      errors.push({
        row: i + 2,
        field: "occurrence",
        message: "사용 위치가 중복됩니다.",
      });
    else
      nodes.set(row.occurrence, {
        ...row,
        level: 0,
        children: [],
        quantityPerRoot: null,
      });
  });
  const roots: string[] = [];
  for (const node of nodes.values()) {
    if (!node.parent) roots.push(node.occurrence);
    else nodes.get(node.parent)?.children.push(node.occurrence);
  }
  const queue = [...roots];
  for (const id of roots) {
    nodes.get(id)!.level = 1;
    nodes.get(id)!.quantityPerRoot = 1;
  }
  for (let i = 0; i < queue.length; i++) {
    const node = nodes.get(queue[i])!;
    for (const id of node.children) {
      const child = nodes.get(id)!;
      child.level = node.level + 1;
      const quantity = (node.quantityPerRoot ?? NaN) * child.quantity;
      child.quantityPerRoot = Number.isFinite(quantity) ? quantity : null;
      queue.push(id);
    }
  }
  rows.forEach((row, i) => {
    const node = nodes.get(row.occurrence)!;
    const message =
      row.parent && !nodes.has(row.parent)
        ? "상위 사용 위치를 찾을 수 없습니다."
        : !node.level
          ? "BOM 계층이 순환하거나 유효한 상위 위치에 연결되지 않았습니다."
          : node.level > MAX_BOM_LEVEL
            ? `L${node.level} 항목입니다. BOM은 L1~L${MAX_BOM_LEVEL}까지 지원합니다.`
            : "";
    if (message) errors.push({ row: i + 2, field: "parent", message });
  });
  return {
    nodes,
    roots,
    errors,
    maxLevel: Math.max(0, ...Array.from(nodes.values(), (n) => n.level)),
  };
}

export function bomPath(nodes: Map<string, BomNode>, id: string) {
  const path: BomNode[] = [];
  const seen = new Set<string>();
  let node = nodes.get(id);
  while (node && !seen.has(node.occurrence)) {
    path.push(node);
    seen.add(node.occurrence);
    node = nodes.get(node.parent);
  }
  return path.reverse();
}

export function searchBom(nodes: Map<string, BomNode>, query: string) {
  const text = query.trim().toLocaleLowerCase();
  return Array.from(nodes.values()).filter((node) =>
    [node.part, node.name, node.occurrence].some((value) =>
      value.toLocaleLowerCase().includes(text),
    ),
  );
}

export function visibleBomNodes(
  index: ReturnType<typeof indexBom>,
  expanded: Set<string>,
  included?: Set<string>,
) {
  const rows: BomNode[] = [];
  const stack = [...index.roots].reverse();
  while (stack.length) {
    const node = index.nodes.get(stack.pop()!)!;
    if (included && !included.has(node.occurrence)) continue;
    rows.push(node);
    if (included || expanded.has(node.occurrence))
      stack.push(...[...node.children].reverse());
  }
  return rows;
}
