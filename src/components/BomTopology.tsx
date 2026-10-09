import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type FitViewOptions,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  Cpu,
  Fan,
  Focus,
  HardDrive,
  Info,
  Maximize2,
  MessageSquare,
  Network,
  Zap,
} from "lucide-react";
import {
  bomPath,
  visibleBomNodes,
  type BomNode,
  type indexBom,
} from "../shared/bom";
import type { BomRow } from "../shared/model";
import { layoutBomTopology } from "../lib/bom-topology";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";

export const bomLabel = (row: Partial<BomRow>) =>
  row.name || row.part || "공개 요청 항목";
export function bomIcon(row?: Partial<BomRow>) {
  switch (row?.category) {
    case "전원":
      return Zap;
    case "연산":
    case "메모리":
      return Cpu;
    case "시스템 보드":
      return CircuitBoard;
    case "스토리지":
      return HardDrive;
    case "냉각":
      return Fan;
    case "네트워크":
      return Network;
    default:
      return Box;
  }
}
type ObjectData = {
  node: BomNode;
  parentName: string;
  open: boolean;
  ancestor: boolean;
  matching: boolean;
  published: boolean;
  omitted: number;
  onToggle: (id: string) => void;
  onInspect: () => void;
  onDiscuss?: () => void;
};
type ObjectNode = Node<ObjectData, "bomObject">;
const BomObject = memo(function BomObject({
  data,
  selected,
}: NodeProps<ObjectNode>) {
  const { node } = data;
  const Icon = bomIcon(node);
  return (
    <div
      className="bom-object"
      data-open={data.open}
      data-selected={selected}
      data-ancestor={data.ancestor}
      data-match={data.matching}
    >
      <div className="bom-object-heading">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="bom-object-label">
              <Icon aria-hidden="true" />
              <span>
                <small>{data.published ? "공개 요청" : `L${node.level}`}</small>
                <strong>{bomLabel(node)}</strong>
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>
              {bomLabel(node)} · {node.occurrence}
            </p>
            {!data.published && <p>상위: {data.parentName || "최상위 구성"}</p>}
          </TooltipContent>
        </Tooltip>
        {selected && node.children.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              className="nodrag nopan"
              aria-label="선택한 구성 상세 보기"
              onClick={(e) => {
                e.stopPropagation();
                data.onInspect();
              }}
            >
              <Info />
            </Button>
            {data.onDiscuss && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="nodrag nopan"
                aria-label="선택한 구성 협의 열기"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onDiscuss?.();
                }}
              >
                <MessageSquare />
              </Button>
            )}
          </>
        )}
        {node.children.length > 0 && !data.published && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="nodrag nopan"
            aria-label={`${bomLabel(node)} 영역 ${data.open ? "접기" : "펼치기"}`}
            aria-expanded={data.open}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggle(node.occurrence);
            }}
          >
            {data.open ? <ChevronDown /> : <ChevronRight />}
          </Button>
        )}
        {selected && !node.children.length && (
          <Check className="bom-object-check" aria-label="선택됨" />
        )}
      </div>
      {!data.open && (
        <div className="bom-object-meta">
          <span>{node.part || "공개 항목"}</span>
          {!data.published && (
            <span>
              {node.children.length
                ? `하위 ${node.children.length}개`
                : node.occurrence}
            </span>
          )}
        </div>
      )}
      {data.omitted > 0 && (
        <span className="bom-object-omitted">
          하위 {data.omitted}개 추가 · 트리에서 선택
        </span>
      )}
      <NodeToolbar
        isVisible={selected && !node.children.length}
        position={Position.Top}
        offset={9}
      >
        <div className="bom-object-actions nodrag nopan">
          <Button variant="ghost" size="xs" onClick={data.onInspect}>
            <Info data-icon="inline-start" />
            상세 보기
          </Button>
          {data.onDiscuss && (
            <Button variant="ghost" size="xs" onClick={data.onDiscuss}>
              <MessageSquare data-icon="inline-start" />
              협의 열기
            </Button>
          )}
        </div>
      </NodeToolbar>
    </div>
  );
});
const nodeTypes = { bomObject: BomObject };
// Leave a clear lane for the floating viewport controls above the root header.
const overviewFit: FitViewOptions = {
  padding: { top: "56px", bottom: "20px", x: "24px" },
  maxZoom: 1,
};

// Only explicit view commands change the viewport after the initial fit.
function ViewportTools({
  selected,
  reduceMotion,
}: {
  selected: string;
  reduceMotion: boolean;
}) {
  const zoom = useStore((s) => s.transform[2]);
  const { fitView, getNode } = useReactFlow();
  return (
    <Panel position="top-right" className="bom-viewport-tools">
      <span>{Math.round(zoom * 100)}%</span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="선택한 구성에 맞추기"
        disabled={!selected || !getNode(selected)}
        onClick={() =>
          void fitView({
            nodes: [{ id: selected }],
            padding: 0.35,
            maxZoom: 1.25,
            duration: reduceMotion ? 0 : 220,
          })
        }
      >
        <Focus />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          void fitView({
            ...overviewFit,
            duration: reduceMotion ? 0 : 220,
          })
        }
      >
        <Maximize2 data-icon="inline-start" />
        전체 보기
      </Button>
    </Panel>
  );
}

export function BomTopology({
  index,
  selected,
  onSelect,
  expanded,
  onExpandedChange,
  query,
  matches,
  reduceMotion,
  published,
  onInspect,
  onDiscuss,
}: {
  index: ReturnType<typeof indexBom>;
  selected: string;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  onExpandedChange: (next: Set<string>) => void;
  query: string;
  matches: string[];
  reduceMotion: boolean;
  published: boolean;
  onInspect: () => void;
  onDiscuss?: () => void;
}) {
  const [depth, setDepth] = useState(5);
  const [treeLimit, setTreeLimit] = useState(100);
  // Search results and breadcrumbs can select outside this component.
  useEffect(() => {
    setDepth((current) =>
      Math.max(current, index.nodes.get(selected)?.level ?? 1),
    );
  }, [index, selected]);
  const branch = useMemo(
    () => new Set(bomPath(index.nodes, selected).map((n) => n.occurrence)),
    [index, selected],
  );
  const included = useMemo(
    () =>
      new Set(
        matches.flatMap((id) =>
          bomPath(index.nodes, id).map((n) => n.occurrence),
        ),
      ),
    [index, matches],
  );
  const tree = useMemo(
    () => visibleBomNodes(index, expanded, query.trim() ? included : undefined),
    [index, expanded, included, query],
  );
  const layout = useMemo(
    () => layoutBomTopology(index, expanded, depth, selected),
    [index, expanded, depth, selected],
  );
  const treeRef = useRef<HTMLDivElement>(null);
  const selectedInTree = tree.some((n) => n.occurrence === selected);
  useEffect(() => {
    setTreeLimit((old) =>
      Math.max(old, tree.findIndex((n) => n.occurrence === selected) + 1),
    );
  }, [selected, tree]);
  function select(id: string) {
    const level = index.nodes.get(id)?.level ?? 1;
    if (level > depth) setDepth(level);
    onSelect(id);
  }
  function toggle(id: string) {
    const next = new Set(expanded);
    const isVisible =
      expanded.has(id) && (index.nodes.get(id)?.level ?? 0) < depth;
    if (isVisible) next.delete(id);
    else {
      next.add(id);
      setDepth((d) =>
        Math.max(d, Math.min(5, (index.nodes.get(id)?.level ?? 1) + 1)),
      );
    }
    onExpandedChange(next);
  }
  function focusTree(id: string) {
    requestAnimationFrame(() => {
      const items =
        treeRef.current?.querySelectorAll<HTMLElement>("[role=treeitem]");
      Array.from(items ?? [])
        .find((e) => e.dataset.occurrence === id)
        ?.focus();
    });
  }
  const nodes: ObjectNode[] = layout.boxes.map((box) => ({
    id: box.id,
    type: "bomObject",
    position: box.position,
    parentId: box.parentId,
    extent: box.parentId ? "parent" : undefined,
    width: box.width,
    height: box.height,
    style: { width: box.width, height: box.height },
    selected: selected === box.id,
    draggable: false,
    ariaLabel: `${published ? "공개 요청" : `L${index.nodes.get(box.id)!.level}`} ${bomLabel(index.nodes.get(box.id)!)} 선택`,
    data: {
      node: index.nodes.get(box.id)!,
      parentName: box.parentId ? bomLabel(index.nodes.get(box.parentId)!) : "",
      open: box.open,
      omitted: box.omitted,
      ancestor: branch.has(box.id),
      matching: Boolean(query.trim()) && matches.includes(box.id),
      published,
      onToggle: toggle,
      onInspect,
      onDiscuss: selected === box.id ? onDiscuss : undefined,
    },
  }));
  if (!nodes.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>표시할 BOM이 없습니다.</EmptyTitle>
          <EmptyDescription>
            공개된 항목 또는 발행된 BOM을 확인하세요.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <TooltipProvider delayDuration={350}>
      <div className="bom-topology-layout">
        <aside
          className="bom-outline"
          aria-label={published ? "공개 요청 목록" : "BOM 트리"}
        >
          <div className="bom-outline-heading">
            <h3>{published ? "공개 요청" : "BOM 트리"}</h3>
            {!published && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  onExpandedChange(new Set(index.nodes.keys()));
                  setDepth(5);
                }}
              >
                모두 펼치기
              </Button>
            )}
          </div>
          <div
            ref={treeRef}
            className="bom-outline-scroll"
            role="tree"
            aria-label="BOM 포함 계층"
          >
            {tree.slice(0, treeLimit).map((n, i) => {
              const Icon = bomIcon(n),
                open = Boolean(query.trim()) || expanded.has(n.occurrence);
              const parent = n.parent ? index.nodes.get(n.parent) : undefined;
              const siblings = parent?.children ?? index.roots;
              return (
                <div
                  key={n.occurrence}
                  role="treeitem"
                  tabIndex={
                    selected === n.occurrence || (!selectedInTree && i === 0)
                      ? 0
                      : -1
                  }
                  aria-label={`${published ? "공개 요청" : `L${n.level}`} ${bomLabel(n)}`}
                  aria-level={published ? 1 : n.level}
                  aria-posinset={siblings.indexOf(n.occurrence) + 1}
                  aria-setsize={siblings.length}
                  aria-selected={selected === n.occurrence}
                  aria-expanded={n.children.length ? open : undefined}
                  data-occurrence={n.occurrence}
                  data-selected={selected === n.occurrence}
                  className="bom-outline-item"
                  style={{ paddingInlineStart: 8 + (n.level - 1) * 12 }}
                  onClick={() => select(n.occurrence)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    let target = "";
                    if (event.key === "ArrowDown")
                      target =
                        tree[Math.min(tree.length - 1, i + 1)].occurrence;
                    else if (event.key === "ArrowUp")
                      target = tree[Math.max(0, i - 1)].occurrence;
                    else if (event.key === "Home") target = tree[0].occurrence;
                    else if (event.key === "End")
                      target = tree[tree.length - 1].occurrence;
                    else if (event.key === "ArrowRight" && n.children.length) {
                      if (!open)
                        onExpandedChange(new Set([...expanded, n.occurrence]));
                      else target = n.children[0];
                    } else if (event.key === "ArrowLeft") {
                      if (n.children.length && open && !query.trim()) {
                        const next = new Set(expanded);
                        next.delete(n.occurrence);
                        onExpandedChange(next);
                      } else target = n.parent;
                    } else if (event.key === "Enter" || event.key === " ")
                      select(n.occurrence);
                    else return;
                    event.preventDefault();
                    if (target) {
                      select(target);
                      focusTree(target);
                    }
                  }}
                >
                  {n.children.length ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      tabIndex={-1}
                      aria-label={`${bomLabel(n)} 트리 ${open ? "접기" : "펼치기"}`}
                      disabled={Boolean(query.trim())}
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = new Set(expanded);
                        if (!next.delete(n.occurrence)) next.add(n.occurrence);
                        onExpandedChange(next);
                      }}
                    >
                      {open ? <ChevronDown /> : <ChevronRight />}
                    </Button>
                  ) : (
                    <span className="bom-outline-spacer" />
                  )}
                  <Icon aria-hidden="true" />
                  <span
                    className="bom-outline-name"
                    title={`${bomLabel(n)} · ${n.occurrence}`}
                  >
                    {bomLabel(n)}
                  </span>
                  {!published && <span className="bom-depth">L{n.level}</span>}
                </div>
              );
            })}
            {!tree.length && (
              <p className="bom-outline-note">검색 결과가 없습니다.</p>
            )}
            {tree.length > treeLimit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTreeLimit((old) => old + 100)}
              >
                100개 더 보기
              </Button>
            )}
          </div>
          <div className="bom-outline-note">
            {published
              ? "공유받은 항목만 표시합니다."
              : "부품을 선택하면 포함 경로가 강조됩니다."}
          </div>
        </aside>
        <section className="bom-topology" aria-label="오브젝트 토폴로지">
          <div className="bom-topology-heading">
            <h3>{published ? "공개 요청 구성" : "오브젝트 토폴로지"}</h3>
            {!published && (
              <Field orientation="horizontal" className="bom-depth-control">
                <FieldLabel htmlFor="bom-depth">표시 깊이</FieldLabel>
                <NativeSelect
                  id="bom-depth"
                  size="sm"
                  value={depth}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setDepth(value);
                    onExpandedChange(
                      new Set(
                        Array.from(index.nodes.values())
                          .filter((n) => n.level < value)
                          .map((n) => n.occurrence),
                      ),
                    );
                  }}
                >
                  {[1, 2, 3, 4, 5].map((d) => (
                    <NativeSelectOption key={d} value={d}>
                      L{d}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
          <div className="bom-topology-canvas" data-reduced={reduceMotion}>
            <ReactFlowProvider>
              <ReactFlow
                fitView
                fitViewOptions={overviewFit}
                nodes={nodes}
                edges={[]}
                nodeTypes={nodeTypes}
                minZoom={0.12}
                maxZoom={2}
                nodesDraggable={false}
                nodesConnectable={false}
                elevateNodesOnSelect={false}
                deleteKeyCode={null}
                zoomOnDoubleClick={false}
                onNodeClick={(_, n) => select(n.id)}
                onKeyDownCapture={(event) => {
                  if ((event.target as HTMLElement).closest("button")) return;
                  const id = (event.target as HTMLElement)
                    .closest(".react-flow__node")
                    ?.getAttribute("data-id");
                  if (id && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    select(id);
                  }
                }}
                ariaLabelConfig={{
                  "node.a11yDescription.default":
                    "Enter 또는 Space로 부품을 선택하세요. 포함 관계는 변경되지 않습니다.",
                  "controls.ariaLabel": "토폴로지 보기 조절",
                  "controls.zoomIn.ariaLabel": "토폴로지 확대",
                  "controls.zoomOut.ariaLabel": "토폴로지 축소",
                  "controls.fitView.ariaLabel": "토폴로지 전체 보기",
                }}
              >
                <Background gap={18} size={1} color="var(--graph-dot)" />
                <ViewportTools
                  selected={selected}
                  reduceMotion={reduceMotion}
                />
                <MiniMap
                  style={{ width: 112, height: 74 }}
                  pannable
                  zoomable
                  ariaLabel="BOM 전체 위치"
                  position="bottom-right"
                  nodeColor={(n) =>
                    n.selected ? "var(--primary)" : "var(--muted)"
                  }
                  nodeStrokeColor="var(--graph-line)"
                  maskColor="var(--viewer-mask)"
                />
                <Controls showInteractive={false} showFitView={false} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
          <div className="bom-map-caption">
            <Info size={13} />
            <span>
              {published
                ? "공개한 요청 범위"
                : "영역은 포함 관계를 뜻합니다. 빈 공간 드래그 · 휠로 확대"}
              {layout.omitted > 0 &&
                ` · ${layout.boxes.length}개 표시, ${layout.omitted}개는 트리에서 선택`}
            </span>
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
