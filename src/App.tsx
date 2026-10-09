import { BomExplorer } from "./components/BomExplorer";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCheck,
  CircleHelp,
  Clock3,
  FileClock,
  FolderKanban,
  GitBranch,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Network,
  Search,
  Settings2,
  ShieldCheck,
  FileSearch,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "./lib/utils";
import { api, ApiError, setCsrf } from "./lib/api";
import type { Actor, SupplierKey, Workspace } from "./shared/model";
import { NavigationCommand } from "./components/NavigationCommand";
import type { InspectorPanel } from "./shared/navigation";
import { roleLabels } from "./shared/model";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Field, FieldGroup, FieldLabel } from "./components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "./components/ui/native-select";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Switch } from "./components/ui/switch";
import { Skeleton } from "./components/ui/skeleton";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { D2SGraph, ServerIllustration } from "./components/D2SGraph";
import {
  ActionDialog,
  Awards,
  Compare,
  Inspector,
  SettingsDialog,
  FactsDialog,
  type ActionForm,
} from "./components/WorkspacePanels";

const demoAccounts = [
  { email: "lead@demo.local", label: "구매기업 · 통합 검토 담당자" },
  { email: "buyer@demo.local", label: "구매 담당자" },
  { email: "design@demo.local", label: "설계·기술 검토자" },
  { email: "quality@demo.local", label: "품질 검토자" },
  { email: "approval@demo.local", label: "선정 승인자" },
  { email: "a@supplier.demo", label: "공급사 A 담당자" },
  { email: "b@supplier.demo", label: "공급사 B 담당자" },
  { email: "reuse@demo.local", label: "두 번째 기업 · 재사용 검증" },
];
function Brand() {
  return (
    <div className="brand">
      <div className="brand-symbol">
        <GitBranch size={24} />
      </div>
      <span>
        CAIDENTIA<small>DESIGN TO SOURCE</small>
      </span>
    </div>
  );
}
function Login({ done }: { done: () => void }) {
  const [email, setEmail] = useState("lead@demo.local"),
    [password, setPassword] = useState("D2S-demo-2026!");
  const mutation = useMutation({
    mutationFn: () =>
      api<{ actor: Actor; csrf: string }>("/login", { email, password }),
    onSuccess: (result) => {
      setCsrf(result.csrf);
      done();
    },
  });
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-copy">
          <Badge variant="outline">D2S WORKSPACE</Badge>
          <h1>
            설계의 맥락을,
            <br />
            선정의 근거로.
          </h1>
          <p>
            요구조건과 BOM, 공급사의 제안과 검증을
            <br />
            하나의 업무 공간에서 연결합니다.
          </p>
          <ServerIllustration />
          <div className="login-chain">
            <span>설계</span>
            <ArrowRight size={16} />
            <span>검증</span>
            <ArrowRight size={16} />
            <span>선정</span>
          </div>
        </div>
        <p className="login-note">서버 전원 모듈 · 합성 데이터 검증 환경</p>
      </section>
      <section className="login-form">
        <Card>
          <CardHeader>
            <CardTitle>업무 공간 열기</CardTitle>
            <CardDescription>
              역할별 계정으로 공개 범위와 다음 행동을 확인하세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              id="login-form"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="account">모의 검증 계정</FieldLabel>
                  <NativeSelect
                    id="account"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full"
                  >
                    {demoAccounts.map((account) => (
                      <NativeSelectOption
                        key={account.email}
                        value={account.email}
                      >
                        {account.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="login-email">이메일</FieldLabel>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="login-password">비밀번호</FieldLabel>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
              </FieldGroup>
            </form>
            {mutation.error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              form="login-form"
              size="lg"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : null}
              업무 공간 열기
              <ArrowRight data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
        <p className="login-disclaimer">
          모든 품목·가격·물량은 모의 자료입니다.
          <br />
          통합 검토 계정은 역할 겸임을 허용한 검증 계정입니다.
        </p>
      </section>
    </div>
  );
}
function Stat({
  label,
  value,
  suffix,
  description,
  icon: Icon,
  accent = false,
  progress,
}: {
  label: string;
  value: number;
  suffix: string;
  description: string;
  icon: typeof Box;
  accent?: boolean;
  progress?: number;
}) {
  return (
    <Card className={cn("stat-card", accent && "stat-accent")}>
      <CardHeader>
        <div className="stat-label">
          <CardDescription>{label}</CardDescription>
          <Icon size={17} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="stat-value">
          <motion.strong
            key={value}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14 }}
          >
            {value.toLocaleString()}
          </motion.strong>
          <span>{suffix}</span>
        </div>
        {progress !== undefined && (
          <div
            className="capacity-bar"
            role="progressbar"
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={500}
          >
            <div style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        )}
      </CardContent>
      <CardFooter>
        <span>{description}</span>
      </CardFooter>
    </Card>
  );
}
export default function App() {
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const result = await api<{ actor: Actor; csrf: string }>("/me");
      setCsrf(result.csrf);
      return result;
    },
    retry: false,
    staleTime: 60000,
  });
  const workspace = useQuery({
    queryKey: ["workspace", session.data?.actor.id],
    queryFn: async ({ signal }) => {
      const incoming = await api<Workspace>("/workspace", undefined, signal);
      const current = client.getQueryData<Workspace>([
        "workspace",
        incoming.actor.id,
      ]);
      return current && current.version > incoming.version ? current : incoming;
    },
    enabled: Boolean(session.data),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const [inspectorPanel, setInspectorPanel] =
    useState<InspectorPanel>("review");
  const [selected, setSelected] = useState<SupplierKey>("B"),
    [tab, setTab] = useState("map"),
    [settings, setSettings] = useState(false),
    [facts, setFacts] = useState(false),
    [form, setForm] = useState<ActionForm | null>(null),
    [connected, setConnected] = useState(false),
    [chatOpen, setChatOpen] = useState(false);
  const [reduced, setReduced] = useState(
    () => localStorage.getItem("d2s-reduced-motion") === "true",
  );
  const systemReduced = useReducedMotion(),
    reduceMotion = reduced || Boolean(systemReduced);
  const refresh = () => client.invalidateQueries({ queryKey: ["workspace"] });
  const mutation = useMutation({
    mutationFn: ({
      action,
      payload,
    }: {
      action: string;
      payload: Record<string, unknown>;
    }) =>
      api<Workspace>("/commands", {
        action,
        payload,
        expectedVersion: workspace.data!.version,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: async (data) => {
      await client.cancelQueries({ queryKey: ["workspace", data.actor.id] });
      client.setQueryData(
        ["workspace", data.actor.id],
        (old: Workspace | undefined) =>
          !old || data.version >= old.version ? data : old,
      );
      toast.success("변경을 저장했습니다.");
      setForm(null);
    },
    onError: (error) => {
      toast.error(error.message);
      if (error instanceof ApiError && error.status === 409) void refresh();
    },
  });
  const act = async (action: string, payload: Record<string, unknown>) => {
    await mutation.mutateAsync({ action, payload });
  };
  useEffect(() => {
    if (!session.data) return;
    const events = new EventSource("/api/events");
    events.onopen = () => setConnected(true);
    events.onmessage = () => {
      setConnected(true);
      void client.invalidateQueries({ queryKey: ["workspace"] });
      void client.invalidateQueries({ queryKey: ["files"] });
    };
    events.onerror = () => setConnected(false);
    events.addEventListener("revoked", () => {
      events.close();
      client.clear();
      toast.error("접근 권한을 다시 확인하세요.");
      void client.invalidateQueries({ queryKey: ["session"] });
    });
    return () => events.close();
  }, [session.data?.actor.id, client]);
  useEffect(() => {
    if (workspace.data?.actor.supplier)
      setSelected(workspace.data.actor.supplier);
  }, [workspace.data?.actor.supplier]);
  async function logout() {
    try {
      await api("/logout", {});
    } finally {
      client.clear();
      setCsrf("");
      window.location.reload();
    }
  }
  if (session.isPending)
    return (
      <main className="app-loading">
        <Brand />
        <Skeleton className="h-7 w-52" />
        <p>업무 공간을 확인하고 있습니다.</p>
      </main>
    );
  if (!session.data)
    return (
      <>
        <Login
          done={() => {
            void client.invalidateQueries({ queryKey: ["session"] });
          }}
        />
        <Toaster />
      </>
    );
  if (workspace.error)
    return (
      <main className="app-loading">
        <Alert variant="destructive">
          <AlertTitle>업무 공간을 열 수 없습니다.</AlertTitle>
          <AlertDescription>{workspace.error.message}</AlertDescription>
        </Alert>
        <Button onClick={() => void logout()}>로그인 화면으로</Button>
      </main>
    );
  if (!workspace.data)
    return (
      <main className="app-loading">
        <Brand />
        <Skeleton className="h-40 w-96" />
      </main>
    );
  const w = workspace.data,
    supplier = w.suppliers.find((c) => c.key === selected) ?? w.suppliers[0],
    isSupplier = Boolean(w.actor.supplier),
    metrics = w.metrics;
  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      <div
        className="app-shell"
        data-reduced={reduceMotion}
        data-chat-open={chatOpen}
        data-view={tab}
      >
        <aside className="sidebar">
          <Brand />
          <div className="workspace-label">WORKSPACE</div>
          <nav aria-label="주 메뉴">
            <Button
              variant={tab === "map" ? "secondary" : "ghost"}
              title="D2S 프로젝트"
              className="nav-item"
              onClick={() => setTab("map")}
            >
              <LayoutDashboard data-icon="inline-start" />
              D2S 프로젝트
            </Button>
            <Button
              variant={tab === "bom" ? "secondary" : "ghost"}
              title="BOM·구성"
              className="nav-item"
              onClick={() => setTab("bom")}
            >
              <Layers3 data-icon="inline-start" />
              BOM·구성
            </Button>
            <Button
              variant={tab === "compare" ? "secondary" : "ghost"}
              title={isSupplier ? "나의 제안" : "공급 대안"}
              className="nav-item"
              onClick={() => setTab("compare")}
            >
              <Users data-icon="inline-start" />
              {isSupplier ? "나의 제안" : "공급 대안"}
            </Button>
            {!isSupplier && (
              <Button
                variant={tab === "awards" ? "secondary" : "ghost"}
                title="선정·결정 이력"
                className="nav-item"
                onClick={() => setTab("awards")}
              >
                <FileClock data-icon="inline-start" />
                선정·결정 이력
              </Button>
            )}
          </nav>
          <div className="sidebar-project">
            <span>진행 중인 프로젝트</span>
            <div>
              <span className="project-dot" />{" "}
              {isSupplier ? "전원 모듈 협의" : "S-RACK DEMO"}
            </div>
            <small>
              {isSupplier
                ? supplier.request.specification
                : "데이터센터용 서버"}
            </small>
          </div>
          <div className="sidebar-bottom">
            <div className="security-note">
              <ShieldCheck size={18} />
              <span>
                권한에 맞는
                <br />
                업무 공간
              </span>
            </div>
            {w.actor.roles.includes("admin") && (
              <Button
                variant="ghost"
                className="nav-item"
                onClick={() => setSettings(true)}
                title="BOM·Extension 설정"
              >
                <Settings2 data-icon="inline-start" />
                BOM·Extension 설정
              </Button>
            )}
            <div className="motion-preference">
              <Switch
                id="reduce-motion"
                aria-label="모션 줄이기"
                checked={reduced}
                onCheckedChange={(value) => {
                  setReduced(value);
                  localStorage.setItem("d2s-reduced-motion", String(value));
                }}
              />
              <label htmlFor="reduce-motion">모션 줄이기</label>
            </div>
            <small className="environment-label">합성 데이터 검증 환경</small>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              <FolderKanban size={16} />
              <span>프로젝트</span>
              <span>/</span>
              <strong>
                {isSupplier ? "전원 모듈 개별 협의" : "S-RACK DEMO"}
              </strong>
              <Badge variant="outline">D2S</Badge>
            </div>
            <div className="topbar-actions">
              <NavigationCommand
                key={w.actor.id}
                workspace={w}
                selected={supplier.key}
                open={chatOpen}
                onOpenChange={setChatOpen}
                reduceMotion={reduceMotion}
                onNavigate={(navigation) => {
                  setSelected(navigation.supplier);
                  setTab(navigation.tab);
                  setInspectorPanel(navigation.panel);
                }}
              />

              <span className={cn("connection", connected && "online")}>
                <i />
                {connected ? "동기화됨" : "연결 확인 중"}
              </span>
              <Badge variant="secondary">
                {isSupplier ? supplier.name : "구매기업"}
              </Badge>
              <Avatar>
                <AvatarFallback>{w.actor.name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <span className="actor-name">{w.actor.name}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="로그아웃"
                onClick={() => void logout()}
              >
                <LogOut />
              </Button>
            </div>
          </header>
          <main className="workspace-main">
            <section className="project-heading">
              <div>
                <div className="eyebrow">
                  <span className="project-dot" /> DESIGN TO SOURCE
                </div>
                <h1>
                  {isSupplier ? "전원 모듈 개별 협의" : "서버 전원 모듈 소싱"}
                </h1>
                <p>
                  {isSupplier
                    ? `${supplier.request.specification} · 요청 ${supplier.request.quantity.toLocaleString()}개`
                    : `${w.name} · 목표 ${w.target}대`}
                  <span className="heading-divider">|</span>
                  {new Date(w.targetDate).toLocaleDateString("ko-KR")}까지
                </p>
              </div>
              <div className="heading-actions">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setFacts(true)}
                >
                  <FileSearch data-icon="inline-start" />
                  변경 근거
                </Button>
                {w.actions.includes("award.request") && (
                  <Button
                    size="lg"
                    onClick={() =>
                      setForm({
                        action: "award.request",
                        title: "선정안 작성",
                        description:
                          "현재 조건을 충족한 물량만 요청합니다. 부족분의 담당자는 계속 유지합니다.",
                      })
                    }
                  >
                    <CheckCheck data-icon="inline-start" />
                    선정안 작성
                    <ArrowUpRight data-icon="inline-end" />
                  </Button>
                )}
              </div>
            </section>
            {metrics ? (
              <section className="stats-grid" aria-label="조달과 선정 현황">
                <Stat
                  label="조달 충족"
                  value={metrics.coverage}
                  suffix={`/ ${w.target}대`}
                  description="승인 구성 · 유효 확약 · 가용 물량 기준"
                  icon={Box}
                  accent
                  progress={(metrics.coverage / w.target!) * 100}
                />
                <Stat
                  label="잔여 부족분"
                  value={metrics.shortage}
                  suffix="대분"
                  description={`${w.shortageOwner} · 후속 조달 관리`}
                  icon={Clock3}
                />
                <Stat
                  label="선정 승인"
                  value={metrics.selected}
                  suffix={`/ ${w.target}대`}
                  description="조달 가능 수량과 별도로 관리"
                  icon={CheckCheck}
                />
                <Stat
                  label="검토 중인 대안"
                  value={w.suppliers.filter((c) => !c.readiness?.ready).length}
                  suffix="개"
                  description="기술 · 품질 · 공급 조건 확인"
                  icon={GitBranch}
                />
              </section>
            ) : (
              <section className="supplier-summary">
                <Card>
                  <CardHeader>
                    <CardTitle>자사 요청과 제안</CardTitle>
                    <CardDescription>
                      {supplier.request.specification} · {supplier.name}에게
                      공개한 협의 범위
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="supplier-kpis">
                      <div>
                        <span>요청 수량</span>
                        <strong>{supplier.request.quantity}개</strong>
                      </div>
                      <div>
                        <span>제출 확약</span>
                        <strong>{supplier.commitment?.quantity ?? 0}개</strong>
                      </div>
                      <div>
                        <span>게시된 선정</span>
                        <strong>
                          {supplier.publishedAwards.reduce(
                            (s, a) => s + a.quantity,
                            0,
                          )}
                          개
                        </strong>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}
            {metrics && metrics.overallocated > 0 && (
              <Alert variant="destructive">
                <AlertTitle>선정 이후 공급 물량이 감소했습니다.</AlertTitle>
                <AlertDescription>
                  확약 대비 배분 초과 {metrics.overallocated}개. 과거 선정은
                  보존하며 부족분의 재조달을 검토하세요.
                </AlertDescription>
              </Alert>
            )}
            <div className="workspace-grid" data-bom={tab === "bom"}>
              <section className="work-surface">
                <Tabs value={tab} onValueChange={setTab}>
                  <div className="surface-toolbar">
                    <TabsList variant="line">
                      <TabsTrigger value="map">
                        <Network />
                        관계도
                      </TabsTrigger>
                      <TabsTrigger value="bom">
                        <Layers3 />
                        BOM
                      </TabsTrigger>
                      <TabsTrigger value="compare">
                        <Users />
                        {isSupplier ? "나의 제안" : "제안 비교"}
                      </TabsTrigger>
                      {!isSupplier && (
                        <TabsTrigger value="awards">
                          <FileClock />
                          결정 이력
                        </TabsTrigger>
                      )}
                    </TabsList>
                    <span className="version-label">
                      {isSupplier
                        ? supplier.request.specification
                        : `BOM R${w.bomRevision} · 요구조건 v${w.requirement.revision}`}
                    </span>
                  </div>
                  <TabsContent value="map">
                    <div className="canvas-heading">
                      <div>
                        <h2>D2S 연결 현황</h2>
                        <p>
                          대안을 선택하면 검토·협의·다음 행동이 함께 열립니다.
                        </p>
                      </div>
                      <div className="graph-legend">
                        <span>
                          <i className="legend-approved" />
                          승인
                        </span>
                        <span>
                          <i className="legend-pending" />
                          검토 중
                        </span>
                      </div>
                    </div>
                    <D2SGraph
                      workspace={w}
                      selected={supplier.key}
                      onSelect={setSelected}
                      reduceMotion={reduceMotion}
                    />
                    <div className="canvas-foot">
                      <ShieldCheck size={14} />
                      <span>
                        {isSupplier
                          ? "공개한 요청과 자사 업무만 표시합니다."
                          : "다른 부품은 500대분 확보한 모의 사례 · 조달 충족은 출하 확약과 다릅니다."}
                      </span>
                    </div>
                  </TabsContent>
                  <TabsContent value="bom">
                    <BomExplorer
                      workspace={w}
                      reduceMotion={reduceMotion}
                      onSelect={(key, panel = "review") => {
                        setSelected(key);
                        setTab("map");
                        setInspectorPanel(panel);
                      }}
                    />
                  </TabsContent>
                  <TabsContent value="compare">
                    <Compare
                      workspace={w}
                      onAction={setForm}
                      onSelect={setSelected}
                    />
                  </TabsContent>
                  {!isSupplier && (
                    <TabsContent value="awards">
                      <Awards
                        workspace={w}
                        act={act}
                        onAction={setForm}
                        pending={mutation.isPending}
                      />
                    </TabsContent>
                  )}
                </Tabs>
              </section>
              {tab !== "bom" && (
                <Inspector
                  key={supplier.key}
                  panel={inspectorPanel}
                  onPanelChange={setInspectorPanel}
                  workspace={w}
                  supplier={supplier}
                  act={act}
                  onAction={setForm}
                  pending={mutation.isPending}
                />
              )}
            </div>
            <section className="bottom-grid">
              <Card className="next-action-card">
                <CardHeader>
                  <div className="next-label">
                    <Zap size={16} />
                    <span>다음 행동</span>
                  </div>
                  <CardTitle>
                    {supplier.readiness?.reasons[0] ??
                      (isSupplier
                        ? "제안과 공급 조건을 확인하세요."
                        : metrics &&
                            metrics.coverage <= metrics.selected &&
                            metrics.shortage > 0
                          ? `잔여 ${metrics.shortage}대분의 공급 조건을 확보하세요.`
                          : metrics?.unselected
                            ? "유효 물량의 선정안을 작성하세요."
                            : "잔여 조건과 결과 게시를 확인하세요.")}
                  </CardTitle>
                  <CardDescription>
                    {isSupplier
                      ? "공개 사양과 요청 버전을 기준으로 제안·확약을 제출합니다."
                      : `PSU-${supplier.key} · 선정 전 기술·품질·구성·공급 조건을 각각 확인합니다.`}
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <span>
                    {w.requirement.id} v{w.requirement.revision}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTab("map");
                      document.getElementById("inspector-title")?.focus();
                    }}
                  >
                    검토 패널로
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                </CardFooter>
              </Card>
              <Card className="recent-card">
                <CardHeader>
                  <CardTitle>최근 변경</CardTitle>
                  <CardDescription>공개 범위에 맞는 업무 이력</CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="recent-list">
                    {w.activities
                      .slice(-3)
                      .reverse()
                      .map((activity) => (
                        <li key={activity.id}>
                          <i />
                          <div>
                            <strong>{activity.title}</strong>
                            <span>
                              {activity.actor} · {activity.reference}
                            </span>
                          </div>
                          <time>
                            {new Date(activity.at).toLocaleTimeString("ko-KR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </li>
                      ))}
                  </ol>
                </CardContent>
              </Card>
            </section>
            <footer className="workspace-footer">
              <span>CAIDENTIA · D2S</span>
              <span>
                {w.actor.roles.map((role) => roleLabels[role]).join(" · ")}
                {w.actor.roles.length > 1 ? " · 역할 겸임" : ""}
              </span>
            </footer>
          </main>
        </div>
        {form && (
          <ActionDialog
            form={form}
            workspace={w}
            supplier={supplier}
            pending={mutation.isPending}
            onClose={() => setForm(null)}
            act={act}
          />
        )}
        {settings && (
          <SettingsDialog
            workspace={w}
            onClose={() => setSettings(false)}
            refresh={refresh}
            act={act}
          />
        )}
        {facts && <FactsDialog workspace={w} onClose={() => setFacts(false)} />}
        <Toaster position="bottom-right" />
      </div>
    </MotionConfig>
  );
}
