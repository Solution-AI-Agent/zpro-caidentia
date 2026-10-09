import { memo, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import {
  Box,
  CheckCheck,
  ClipboardCheck,
  FileCheck2,
  Layers3,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import type { SupplierKey, Workspace } from "../shared/model";
import "@xyflow/react/dist/style.css";

type FlowData = {
  title: string;
  subtitle: string;
  status: string;
  state: string;
  icon: LucideIcon;
  supplier?: SupplierKey;
  artwork?: boolean;
};
export function ServerIllustration({ small = false }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 210 134"
      aria-hidden="true"
      className={small ? "server-art small" : "server-art"}
    >
      <defs>
        <linearGradient id="server-top" x2="0.4" y2="1">
          <stop stopColor="#f1f5fa" />
          <stop offset="1" stopColor="#b8c8d9" />
        </linearGradient>
        <linearGradient id="server-front" y2="1" x2="0">
          <stop stopColor="#3e536a" />
          <stop offset="1" stopColor="#162b44" />
        </linearGradient>
      </defs>
      <ellipse cx="106" cy="117" rx="78" ry="10" fill="#19384b" opacity=".08" />
      <path
        d="M24 64 111 21 191 60 106 105Z"
        fill="url(#server-top)"
        stroke="#9bacbf"
      />
      <path d="M24 64 106 105 106 122 24 81Z" fill="url(#server-front)" />
      <path d="m106 105 85-45v18l-85 44Z" fill="#8da2b8" />
      <path d="m43 63 69-33 57 28-66 35Z" fill="#e0e8ef" stroke="#a2b3c5" />
      <path d="m101 44 12-6 28 13-12 7Z" fill="#98acbf" />
      <path d="m54 65 28-14 36 18-27 14Z" fill="#647d97" />
      <path d="m58 65 23-10 29 14-21 10Z" fill="#345972" />
      <path d="m75 62 7-3 13 6-7 4Z" fill="#54c8c6" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <path
          key={i}
          d={`m${118 + i * 7} ${78 - i * 3.5} 9 4`}
          stroke="#849aae"
          strokeWidth="2"
        />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={`m${32 + i * 16} ${72 + i * 8} 10 5`}
          stroke="#95acbc"
          strokeWidth="4"
        />
      ))}
      <circle cx="98" cy="109" r="2" fill="#4bd1b7" />
      <path d="M35 66 110 103" stroke="#eaf6ff" opacity=".5" />
    </svg>
  );
}
const FlowCard = memo(function FlowCard({
  data,
  selected,
}: NodeProps<Node<FlowData>>) {
  const Icon = data.icon;
  return (
    <div className="flow-node" data-selected={selected} data-state={data.state}>
      <Handle type="target" position={Position.Left} />
      <Card size="sm">
        <CardHeader>
          <div className="node-icon">
            <Icon size={17} />
            <span>
              {data.supplier ? `ALTERNATIVE ${data.supplier}` : data.subtitle}
            </span>
          </div>
          <CardTitle>{data.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.artwork ? (
            <ServerIllustration small />
          ) : (
            <p className="node-subtitle">{data.subtitle}</p>
          )}
        </CardContent>
        <CardFooter>
          <Badge variant={data.state === "approved" ? "secondary" : "outline"}>
            {data.state === "approved" ? (
              <CheckCheck data-icon="inline-start" />
            ) : null}
            {data.status}
          </Badge>
        </CardFooter>
      </Card>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
const nodeTypes = { d2s: FlowCard };
function FitCanvas() {
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (width && height) void fitView({ padding: 0.08, duration: 0 });
  }, [width, height, fitView]);
  return null;
}
export function D2SGraph({
  workspace,
  selected,
  onSelect,
  reduceMotion,
}: {
  workspace: Workspace;
  selected: SupplierKey;
  onSelect: (key: SupplierKey) => void;
  reduceMotion: boolean;
}) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (reduceMotion) {
      setPulse(false);
      return;
    }
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 700);
    return () => clearTimeout(timer);
  }, [selected, workspace.version, reduceMotion]);
  const { nodes, edges } = useMemo(() => {
    const count = workspace.suppliers.length;
    const nodes: Node<FlowData>[] = [
      {
        id: "requirement",
        type: "d2s",
        position: { x: 0, y: 122 },
        data: {
          title: "설계 요구조건",
          subtitle: `REQ-PWR-01 · v${workspace.requirement.revision}`,
          status: `${workspace.requirement.voltage} V · ${workspace.requirement.outputW} W`,
          state: "approved",
          icon: FileCheck2,
        },
      },
      {
        id: "bom",
        type: "d2s",
        position: { x: 240, y: 122 },
        data: {
          title: "서버 BOM·구성",
          subtitle: `BOM R${workspace.bomRevision}`,
          status: workspace.bomCount
            ? `${workspace.bomCount}개 사용 위치`
            : "공개 사양",
          state: "approved",
          icon: Layers3,
          artwork: true,
        },
      },
      ...workspace.suppliers.map(
        (c, index): Node<FlowData> => ({
          id: c.key,
          type: "d2s",
          selected: c.key === selected,
          position: { x: 500, y: count === 1 ? 122 : index * 233 },
          data: {
            title: `PSU-${c.key}`,
            subtitle: c.name,
            status:
              c.configuration.state === "approved" ? "구성 승인" : "검토 진행",
            state:
              c.configuration.state === "approved" ? "approved" : "pending",
            icon: Box,
            supplier: c.key,
            artwork: true,
          },
        }),
      ),
      {
        id: "verification",
        type: "d2s",
        position: { x: 765, y: 122 },
        data: {
          title: "검증과 공급 확약",
          subtitle: "기술 · 품질 · 기간 · 물량",
          status: workspace.metrics
            ? `${workspace.metrics.coverage}대분 조건 충족`
            : "공개 검토 상태",
          state:
            workspace.metrics?.coverage === workspace.target
              ? "approved"
              : "pending",
          icon: ClipboardCheck,
        },
      },
      {
        id: "selection",
        type: "d2s",
        position: { x: 1010, y: 122 },
        data: {
          title: "선정과 결정 근거",
          subtitle: "승인 · 배분 · 결과 게시",
          status: workspace.metrics
            ? `${workspace.metrics.selected}대분 선정 승인`
            : `${workspace.suppliers[0].publishedAwards.reduce((sum, a) => sum + a.quantity, 0)}개 결과 게시`,
          state: workspace.metrics?.selected ? "approved" : "pending",
          icon: CheckCheck,
        },
      },
    ];
    const lines = [
      ["requirement", "bom"],
      ...workspace.suppliers.flatMap((c) => [
        ["bom", c.key],
        [c.key, "verification"],
      ]),
      ["verification", "selection"],
    ];
    const edges: Edge[] = lines.map(([source, target]) => ({
      id: `${source}-${target}`,
      source,
      target,
      type: "smoothstep",
      animated:
        pulse && !reduceMotion && (source === selected || target === selected),
      style: {
        stroke:
          source === selected || target === selected
            ? "var(--primary)"
            : "var(--graph-line)",
        strokeWidth: source === selected || target === selected ? 2.2 : 1.4,
      },
    }));
    return { nodes, edges };
  }, [workspace, selected, reduceMotion, pulse]);
  return (
    <div
      className="d2s-canvas"
      aria-label="설계부터 선정까지 D2S 관계도"
      onKeyDownCapture={(event) => {
        const key = (event.target as HTMLElement)
          .closest(".react-flow__node")
          ?.getAttribute("data-id");
        if (
          (event.key === "Enter" || event.key === " ") &&
          (key === "A" || key === "B")
        ) {
          event.preventDefault();
          onSelect(key);
        }
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.35}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        edgesFocusable={false}
        ariaLabelConfig={{
          "node.a11yDescription.default":
            "공급 대안에서 Enter 또는 Space를 누르면 검토 패널이 열립니다.",
          "node.a11yDescription.keyboardDisabled":
            "업무 관계를 표시하는 카드입니다.",
          "controls.ariaLabel": "관계도 보기 조절",
          "controls.zoomIn.ariaLabel": "확대",
          "controls.zoomOut.ariaLabel": "축소",
          "controls.fitView.ariaLabel": "전체 보기",
        }}
        onNodeClick={(_, node) => {
          if (node.data.supplier) onSelect(node.data.supplier as SupplierKey);
        }}
      >
        <FitCanvas />
        <Background gap={20} size={1} color="var(--graph-dot)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
