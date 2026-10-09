import { Fragment, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BomTopology, bomIcon, bomLabel } from "./BomTopology";
import {
  ArrowUpRight,
  Boxes,
  ChevronDown,
  ChevronRight,
  ListTree,
} from "lucide-react";
import { api } from "../lib/api";
import {
  bomPath,
  indexBom,
  MAX_BOM_LEVEL,
  searchBom,
  visibleBomNodes,
} from "../shared/bom";
import type { BomRow, SupplierKey, Workspace } from "../shared/model";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Alert, AlertDescription } from "./ui/alert";

import { Skeleton } from "./ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";

interface BomResponse {
  rows: BomRow[];
  columns: string[];
  total: number;
  revision: number;
  scope: "internal" | "published";
}
const labels: Record<string, string> = {
  occurrence: "사용 위치",
  parent: "상위 위치",
  part: "품목",
  name: "품목명",
  revision: "개정",
  quantity: "수량",
  unit: "단위",
  configuration: "적용 구성",
  category: "분류",
};
const title = bomLabel;
const format = (quantity: number | null | undefined) =>
  quantity == null
    ? "—"
    : quantity.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
const cell = (row: BomRow, field: string) =>
  field.startsWith("attr.")
    ? row.attributes?.[field.slice(5)]
    : row[field as keyof BomRow];
const PAGE_SIZE = 100;

export function BomExplorer({
  workspace,
  onSelect,
  reduceMotion,
}: {
  workspace: Workspace;
  onSelect: (key: SupplierKey, panel?: "review" | "discussion") => void;
  reduceMotion: boolean;
}) {
  const result = useQuery({
    queryKey: ["bom", workspace.actor.id, workspace.bomRevision, "hierarchy"],
    queryFn: ({ signal }) =>
      api<BomResponse>("/bom?view=hierarchy", undefined, signal),
  });
  if (result.isPending)
    return (
      <div className="bom-loading" aria-label="BOM 불러오는 중">
        <Skeleton className="h-9 w-60" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  if (result.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {result.error.message}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void result.refetch()}
          >
            다시 불러오기
          </Button>
        </AlertDescription>
      </Alert>
    );
  return (
    <BomContent
      key={`${workspace.actor.id}:${result.data.revision}`}
      data={result.data}
      workspace={workspace}
      onSelect={onSelect}
      reduceMotion={reduceMotion}
    />
  );
}

function BomContent({
  data,
  workspace,
  onSelect,
  reduceMotion,
}: {
  data: BomResponse;
  workspace: Workspace;
  onSelect: (key: SupplierKey, panel?: "review" | "discussion") => void;
  reduceMotion: boolean;
}) {
  const published = data.scope === "published";
  // The supplier projection omits private hierarchy and fields. Never fill them from internal data.
  const index = useMemo(
    () =>
      indexBom(
        published
          ? data.rows.map((row) => ({
              ...row,
              parent: "",
              name: row.name ?? "",
              part: row.part ?? "",
              category: "",
              attributes: {},
              quantity: 1,
            }))
          : data.rows,
      ),
    [data.rows, published],
  );
  const [selected, setSelected] = useState(() => {
    const source = Array.from(index.nodes.values()).find(
      (n) => n.part === `PSU-${workspace.suppliers[0]?.key}`,
    );
    return source?.children[0] ?? source?.occurrence ?? index.roots[0] ?? "";
  });
  const [mode, setMode] = useState("visual");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(
    () =>
      new Set([
        ...index.roots,
        ...bomPath(index.nodes, selected).map((n) => n.occurrence),
      ]),
  );
  const [page, setPage] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const node = index.nodes.get(selected);
  const path = useMemo(() => bomPath(index.nodes, selected), [index, selected]);
  const searching = Boolean(query.trim());
  const matches = useMemo(
    () =>
      searching && !index.errors.length ? searchBom(index.nodes, query) : [],
    [index, query, searching],
  );
  const included = useMemo(
    () =>
      new Set(
        matches.flatMap((n) =>
          bomPath(index.nodes, n.occurrence).map((a) => a.occurrence),
        ),
      ),
    [index, matches],
  );
  const treeRows = useMemo(
    () => visibleBomNodes(index, expanded, searching ? included : undefined),
    [index, expanded, searching, included],
  );
  const displayed = treeRows;
  const pageStart = Math.min(
    page * PAGE_SIZE,
    Math.max(0, Math.ceil(displayed.length / PAGE_SIZE) - 1) * PAGE_SIZE,
  );
  const shown = displayed.slice(pageStart, pageStart + PAGE_SIZE);
  const source = [...path]
    .reverse()
    .find((n) => workspace.suppliers.some((s) => n.part === `PSU-${s.key}`));
  const related = source
    ? workspace.suppliers.find((s) => source.part === `PSU-${s.key}`)
    : undefined;
  function select(id: string, focus = true) {
    setSelected(id);
    setQuery("");
    const next = new Set([
      ...expanded,
      ...bomPath(index.nodes, id).map((n) => n.occurrence),
    ]);
    setExpanded(next);
    const at =
      mode === "tree"
        ? visibleBomNodes(index, next).findIndex((n) => n.occurrence === id)
        : 0;
    setPage(Math.max(0, Math.floor(at / PAGE_SIZE)));
    if (focus)
      requestAnimationFrame(() =>
        heading.current?.focus({ preventScroll: true }),
      );
  }
  function changeMode(value: string) {
    setMode(value);
    if (value === "tree") {
      const at = treeRows.findIndex((n) => n.occurrence === selected);
      setPage(Math.max(0, Math.floor(at / PAGE_SIZE)));
    } else setPage(0);
  }
  const detail = published ? data.rows[0] : node;
  const DetailIcon = bomIcon(detail);
  return (
    <div className="bom-explorer" data-mode={mode}>
      <div className="bom-toolbar">
        <div>
          <h2>
            {mode === "visual" ? "BOM 구성과 포함 관계" : "BOM · 트리 목록"}
          </h2>
          <p>
            {published
              ? "공유받은 요청 항목을 확인하세요."
              : "트리와 오브젝트를 함께 보며 구성과 소요량을 확인하세요."}
          </p>
        </div>
        <div className="bom-toolbar-meta">
          <Badge variant="outline">BOM R{data.revision}</Badge>
          <Badge variant="secondary">
            {published ? "공개 범위" : `L1–L${MAX_BOM_LEVEL}`}
          </Badge>
          <span>
            {data.total.toLocaleString()}개{" "}
            {published ? "요청 항목" : "사용 위치"}
          </span>
        </div>
      </div>
      {index.errors.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            표시할 수 없는 BOM 계층입니다. {index.errors[0].message} BOM
            설정에서 원본을 확인하세요.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Tabs value={mode} onValueChange={changeMode}>
            <div className="bom-controls">
              <TabsList aria-label="BOM 표시 방식">
                <TabsTrigger value="visual">
                  <Boxes data-icon="inline-start" />
                  토폴로지 뷰
                </TabsTrigger>
                <TabsTrigger value="tree">
                  <ListTree data-icon="inline-start" />
                  트리 목록
                </TabsTrigger>
              </TabsList>
              {!published && (
                <Field className="bom-search">
                  <FieldLabel htmlFor="bom-search" className="sr-only">
                    BOM 전체 검색
                  </FieldLabel>
                  <Input
                    id="bom-search"
                    type="search"
                    placeholder="전체 BOM에서 품목·이름·위치 검색"
                    value={query}
                    maxLength={100}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                  />
                </Field>
              )}
            </div>
            {!published && mode === "visual" && searching && (
              <div className="bom-search-results" aria-label="BOM 검색 결과">
                <span>{matches.length}개 일치</span>
                {matches.slice(0, 12).map((n) => (
                  <Button
                    key={n.occurrence}
                    variant="outline"
                    size="xs"
                    onClick={() => select(n.occurrence, false)}
                  >
                    L{n.level} · {title(n)} · {n.occurrence}
                  </Button>
                ))}
                {!matches.length && (
                  <span>일치하는 항목이 없습니다. 전체 구성을 유지합니다.</span>
                )}
                {matches.length > 12 && (
                  <span>
                    앞 12개 표시 · 검색어를 좁히거나 트리 목록에서 확인하세요.
                  </span>
                )}
              </div>
            )}
            {!published && (
              <Breadcrumb aria-label="BOM 구성 경로" className="bom-breadcrumb">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => select("")}
                      >
                        전체
                      </Button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  {path.map((n, i) => (
                    <Fragment key={n.occurrence}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        {i === path.length - 1 ? (
                          <BreadcrumbPage>
                            L{n.level} · {title(n)}
                          </BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => select(n.occurrence)}
                            >
                              L{n.level} · {title(n)}
                            </Button>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            )}
            <div className="bom-layout">
              <div className="bom-main-view">
                <TabsContent value="visual">
                  <BomTopology
                    index={index}
                    selected={selected}
                    onSelect={(id) => select(id, false)}
                    expanded={expanded}
                    onExpandedChange={setExpanded}
                    query={query}
                    matches={matches.map((n) => n.occurrence)}
                    reduceMotion={reduceMotion}
                    published={published}
                    onInspect={() => {
                      heading.current?.focus({ preventScroll: true });
                      heading.current?.scrollIntoView({
                        block: "nearest",
                        behavior: reduceMotion ? "instant" : "smooth",
                      });
                    }}
                    onDiscuss={
                      related
                        ? () => onSelect(related.key, "discussion")
                        : published
                          ? () =>
                              onSelect(workspace.actor.supplier!, "discussion")
                          : undefined
                    }
                  />
                </TabsContent>
                <TabsContent value="tree">
                  {!published && (
                    <div className="bom-tree-controls">
                      <span>
                        {searching
                          ? "검색 항목과 상위 경로를 함께 표시합니다."
                          : "접기·펼치기로 계층을 확인하세요."}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={searching}
                        onClick={() => {
                          setExpanded(new Set(index.nodes.keys()));
                          setPage(0);
                        }}
                      >
                        모두 펼치기
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={searching}
                        onClick={() => {
                          setExpanded(new Set(index.roots));
                          setPage(0);
                        }}
                      >
                        접기
                      </Button>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {!published && <TableHead>구성 계층</TableHead>}
                        {data.columns.map((f) => (
                          <TableHead key={f}>
                            {labels[f] ?? f.replace("attr.", "")}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(published ? data.rows : shown).map((row) => {
                        const n = index.nodes.get(row.occurrence);
                        return (
                          <TableRow
                            key={row.occurrence}
                            data-state={
                              selected === row.occurrence
                                ? "selected"
                                : undefined
                            }
                          >
                            {!published && n && (
                              <TableCell>
                                <div
                                  className="bom-tree-item"
                                  style={{
                                    paddingInlineStart: (n.level - 1) * 16,
                                  }}
                                >
                                  {n.children.length ? (
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`${title(n)} ${expanded.has(n.occurrence) ? "접기" : "펼치기"}`}
                                      aria-expanded={
                                        searching || expanded.has(n.occurrence)
                                      }
                                      disabled={searching}
                                      onClick={() => {
                                        setExpanded((old) => {
                                          const next = new Set(old);
                                          if (!next.delete(n.occurrence))
                                            next.add(n.occurrence);
                                          return next;
                                        });
                                        setPage(0);
                                      }}
                                    >
                                      {searching ||
                                      expanded.has(n.occurrence) ? (
                                        <ChevronDown />
                                      ) : (
                                        <ChevronRight />
                                      )}
                                    </Button>
                                  ) : (
                                    <span className="bom-tree-spacer" />
                                  )}
                                  <Badge variant="outline">L{n.level}</Badge>
                                  <Button
                                    variant="link"
                                    size="sm"
                                    onClick={() => select(n.occurrence, false)}
                                    aria-current={
                                      selected === n.occurrence
                                        ? "true"
                                        : undefined
                                    }
                                  >
                                    {title(n)}
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                            {data.columns.map((f) => (
                              <TableCell key={f}>
                                {String(cell(row, f) ?? "—")}
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      })}
                      {!published && !shown.length && (
                        <TableRow>
                          <TableCell colSpan={data.columns.length + 1}>
                            검색 결과가 없습니다.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>
                {mode === "tree" &&
                  !published &&
                  displayed.length > PAGE_SIZE && (
                    <div className="table-pagination">
                      <span>
                        {pageStart + 1}–
                        {Math.min(pageStart + PAGE_SIZE, displayed.length)} /{" "}
                        {displayed.length}개
                        {mode === "tree" ? " · 펼친 항목 기준" : ""}
                      </span>
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!pageStart}
                          onClick={() =>
                            setPage(Math.max(0, pageStart / PAGE_SIZE - 1))
                          }
                        >
                          이전
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pageStart + PAGE_SIZE >= displayed.length}
                          onClick={() => setPage(pageStart / PAGE_SIZE + 1)}
                        >
                          다음
                        </Button>
                      </div>
                    </div>
                  )}
              </div>
              <aside className="bom-detail" aria-label="선택한 BOM 항목">
                <Card>
                  <CardHeader>
                    <CardDescription>
                      {published ? "공개 요청 항목" : "선택한 구성"}
                    </CardDescription>
                    <CardTitle>
                      <h3 ref={heading} tabIndex={-1} id="bom-current-title">
                        {detail ? title(detail) : "전체 BOM"}
                      </h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {detail ? (
                      <>
                        <div className="bom-detail-symbol">
                          <DetailIcon />
                          <span>
                            {published ? "공개 요청" : `L${node!.level}`}
                            <small>{detail.category ?? "공개 필드"}</small>
                          </span>
                        </div>
                        <dl className="bom-facts">
                          {(published
                            ? data.columns
                            : [
                                "part",
                                "occurrence",
                                "revision",
                                "configuration",
                                "quantity",
                                "unit",
                              ]
                          ).map((f) => (
                            <div key={f}>
                              <dt>
                                {labels[f] ?? f.replace("attr.", "")}
                                {!published && f === "quantity"
                                  ? " / 상위 1개"
                                  : ""}
                              </dt>
                              <dd>{String(cell(detail, f) ?? "—")}</dd>
                            </div>
                          ))}
                        </dl>
                        {!published && (
                          <div className="bom-rollup">
                            <span>최상위 1개당 소요량</span>
                            <strong>
                              {format(node!.quantityPerRoot)}{" "}
                              <small>{node!.unit}</small>
                            </strong>
                            <p>
                              {node!.level === 1
                                ? "최상위 항목 1개를 기준으로 계산합니다."
                                : path
                                    .slice(1)
                                    .map((n) => format(n.quantity))
                                    .join(" × ") +
                                  " = " +
                                  format(node!.quantityPerRoot)}
                            </p>
                            <p>
                              구성 소요량이며 공급 확약 수량과는 별개입니다.
                            </p>
                          </div>
                        )}
                        {!published &&
                          data.columns.some((f) => f.startsWith("attr.")) && (
                            <dl className="bom-facts">
                              {data.columns
                                .filter((f) => f.startsWith("attr."))
                                .map((f) => (
                                  <div key={f}>
                                    <dt>{f.slice(5)}</dt>
                                    <dd>{String(cell(detail, f) ?? "—")}</dd>
                                  </div>
                                ))}
                            </dl>
                          )}
                      </>
                    ) : (
                      <p>
                        오브젝트를 선택하면 품목과 수량을 확인할 수 있습니다.
                      </p>
                    )}
                  </CardContent>
                  <CardFooter>
                    {published ? (
                      <Button
                        variant="outline"
                        onClick={() => onSelect(workspace.actor.supplier!)}
                      >
                        공급 대안 보기
                        <ArrowUpRight data-icon="inline-end" />
                      </Button>
                    ) : related ? (
                      <div className="bom-d2s-link">
                        <span>
                          {source?.occurrence === selected
                            ? "연결된 공급 대안"
                            : `상위 모듈 ${source?.part}의 공급 대안`}
                        </span>
                        <Button onClick={() => onSelect(related.key)}>
                          PSU-{related.key} 검토
                          <ArrowUpRight data-icon="inline-end" />
                        </Button>
                      </div>
                    ) : (
                      <span>이 항목에 연결된 공급 대안이 없습니다.</span>
                    )}
                  </CardFooter>
                </Card>
              </aside>
            </div>
          </Tabs>
        </>
      )}
    </div>
  );
}
