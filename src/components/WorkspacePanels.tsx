import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  Check,
  CheckCheck,
  ClipboardCheck,
  FileCheck2,
  FileText,
  GitBranch,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Truck,
  Upload,
  X,
} from "lucide-react";
import type {
  BomMapping,
  BomRow,
  SupplierKey,
  SupplierView,
  Workspace,
} from "../shared/model";
import { money, reviewLabels } from "../shared/model";
import { api, fileContent } from "../lib/api";
import { cn } from "../lib/utils";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./ui/message-scroller";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "./ui/message";
import { Bubble, BubbleContent } from "./ui/bubble";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "./ui/attachment";
import { Marker, MarkerContent } from "./ui/marker";
import { ServerIllustration } from "./D2SGraph";

export type Act = (
  action: string,
  payload: Record<string, unknown>,
) => Promise<void>;
export interface ActionForm {
  action: string;
  title: string;
  description: string;
  supplier?: SupplierKey;
  id?: string;
  decision?: "start" | "approve" | "reject";
}
const isoDate = (value: string) =>
  new Date(`${value}T23:59:59.000Z`).toISOString();
const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
function FormField({
  name,
  label,
  type = "text",
  initial,
  required = true,
  min,
  step,
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  initial?: string | number;
  required?: boolean;
  min?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={`field-${name}`}>{label}</FieldLabel>
      {type === "textarea" ? (
        <Textarea
          id={`field-${name}`}
          name={name}
          defaultValue={initial}
          required={required}
          maxLength={4000}
          rows={3}
        />
      ) : (
        <Input
          id={`field-${name}`}
          name={name}
          type={type}
          defaultValue={initial}
          required={required}
          min={min}
          step={step}
        />
      )}{" "}
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}
export function ActionDialog({
  form,
  workspace,
  supplier,
  pending,
  onClose,
  act,
}: {
  form: ActionForm;
  workspace: Workspace;
  supplier: SupplierView;
  pending: boolean;
  onClose: () => void;
  act: Act;
}) {
  const selected =
      workspace.suppliers.find((c) => c.key === form.supplier) ?? supplier,
    offer = selected.proposals.at(-1),
    action = form.action;
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      get = (key: string) => String(data.get(key) ?? ""),
      n = (key: string) => Number(get(key));
    let payload: Record<string, unknown> = { supplier: selected.key };
    if (action.startsWith("review."))
      payload = {
        ...payload,
        decision: form.decision ?? "approve",
        evidence: get("evidence"),
      };
    else if (action.startsWith("proposal."))
      payload = {
        ...payload,
        quantity: n("quantity"),
        minQuantity: n("minQuantity"),
        unitPriceCents: Math.round(n("price") * 100),
        voltage: n("voltage"),
        outputW: n("outputW"),
        availableAt: isoDate(get("availableAt")),
        validUntil: isoDate(get("validUntil")),
        note: get("note"),
      };
    else if (action === "commitment.submit")
      payload = {
        ...payload,
        quantity: n("quantity"),
        availableAt: isoDate(get("availableAt")),
      };
    else if (action === "commitment.reduce")
      payload = { ...payload, quantity: n("quantity"), reason: get("reason") };
    else if (action === "allocation.other" || action === "request.issue")
      payload = { ...payload, quantity: n("quantity") };
    else if (action === "award.request")
      payload = {
        quantities: { A: n("quantityA"), B: n("quantityB") },
        owner: get("owner"),
      };
    else if (action === "award.reject")
      payload = { id: form.id, reason: get("reason") };
    else if (action === "design.revise")
      payload = {
        voltage: n("voltage"),
        outputW: n("outputW"),
        reason: get("reason"),
      };
    else if (action === "membership.revoke")
      payload = { actorId: get("actorId") };
    else if (form.id)
      payload = {
        id: form.id,
        ...(action === "award.publish" ? { supplier: selected.key } : {}),
      };
    setError("");
    try {
      await act(action, payload);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.title}</DialogTitle>
          <DialogDescription>{form.description}</DialogDescription>
        </DialogHeader>
        <form id="action-form" onSubmit={submit}>
          <FieldGroup>
            {action.startsWith("review.") && (
              <FormField
                name="evidence"
                label={
                  form.decision === "reject" ? "반려 사유와 근거" : "검토 근거"
                }
                type="textarea"
                hint="모의 시험·검토 자료의 식별자와 확인 내용을 기록하세요."
              />
            )}
            {action.startsWith("proposal.") && (
              <>
                <div className="form-grid">
                  <FormField
                    name="quantity"
                    label="제안 수량 (개)"
                    type="number"
                    initial={offer?.quantity ?? 400}
                    min={2}
                    step={2}
                  />
                  <FormField
                    name="minQuantity"
                    label="최소 선정 수량 (개)"
                    type="number"
                    initial={offer?.minQuantity ?? 2}
                    min={2}
                    step={2}
                  />
                  <FormField
                    name="price"
                    label="단가 (USD)"
                    type="number"
                    initial={(offer?.unitPriceCents ?? 19600) / 100}
                    min={0.01}
                    step={0.01}
                  />
                  <FormField
                    name="voltage"
                    label="입력 전압 (V)"
                    type="number"
                    initial={offer?.voltage ?? 230}
                  />
                  <FormField
                    name="outputW"
                    label="출력 (W)"
                    type="number"
                    initial={offer?.outputW ?? 1800}
                  />
                  <FormField
                    name="availableAt"
                    label="공급 가능일"
                    type="date"
                    initial={offer?.availableAt.slice(0, 10)}
                  />
                  <FormField
                    name="validUntil"
                    label="제안 유효일까지"
                    type="date"
                    initial={offer?.validUntil.slice(0, 10)}
                  />
                </div>
                <FormField
                  name="note"
                  label="제안 조건"
                  type="textarea"
                  initial={offer?.note}
                  required={false}
                />
              </>
            )}
            {[
              "commitment.submit",
              "commitment.reduce",
              "allocation.other",
              "request.issue",
            ].includes(action) && (
              <FormField
                name="quantity"
                label={
                  action === "allocation.other"
                    ? "다른 프로젝트의 배분 수량 (개)"
                    : "수량 (개)"
                }
                type="number"
                initial={
                  action === "allocation.other"
                    ? 100
                    : action === "commitment.reduce"
                      ? Math.max(
                          0,
                          (selected.commitment?.quantity ?? 400) - 100,
                        )
                      : selected.request.quantity
                }
                min={0}
                step={2}
              />
            )}
            {action === "commitment.submit" && (
              <FormField
                name="availableAt"
                label="공급 가능일"
                type="date"
                initial={offer?.availableAt.slice(0, 10)}
              />
            )}
            {["commitment.reduce", "award.reject", "design.revise"].includes(
              action,
            ) && <FormField name="reason" label="변경 사유" type="textarea" />}
            {action === "award.request" && (
              <>
                {workspace.suppliers.map((c) => (
                  <FormField
                    key={c.key}
                    name={`quantity${c.key}`}
                    label={`공급사 ${c.key} 선정 수량 (개)`}
                    type="number"
                    min={0}
                    step={2}
                    initial={
                      c.readiness?.ready
                        ? Math.max(
                            0,
                            Math.floor(
                              (c.readiness.available - c.readiness.assigned) /
                                2,
                            ) * 2,
                          )
                        : 0
                    }
                    hint={
                      c.readiness?.ready
                        ? `잔여 가용 ${c.readiness.available - c.readiness.assigned}개 · 서버당 2개`
                        : "필수 조건 확인 전에는 선정할 수 없습니다."
                    }
                  />
                ))}
                <FormField
                  name="owner"
                  label="잔여 물량 조달 담당자"
                  initial={workspace.shortageOwner ?? workspace.actor.name}
                />
              </>
            )}
            {action === "design.revise" && (
              <div className="form-grid">
                <FormField
                  name="voltage"
                  label="새 요구 전압 (V)"
                  type="number"
                  initial={workspace.requirement.voltage}
                />
                <FormField
                  name="outputW"
                  label="새 요구 출력 (W)"
                  type="number"
                  initial={workspace.requirement.outputW}
                />
              </div>
            )}
            {action === "membership.revoke" && (
              <FormField
                name="actorId"
                label="참여자 식별자"
                hint="예: supplier-b. 철회 후 해당 계정의 새 조회·전송을 차단합니다."
              />
            )}
          </FieldGroup>
        </form>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            취소
          </Button>
          <Button form="action-form" type="submit" disabled={pending}>
            {pending && (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            )}
            확인하고 저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Inspector({
  panel,
  onPanelChange,
  workspace,
  supplier,
  act,
  onAction,
  pending,
}: {
  panel: "review" | "discussion" | "files";
  onPanelChange: (panel: "review" | "discussion" | "files") => void;
  workspace: Workspace;
  supplier: SupplierView;
  act: Act;
  onAction: (form: ActionForm) => void;
  pending: boolean;
}) {
  const config = supplier.configuration,
    allowed = (action: string) => workspace.actions.includes(action);
  const open = (
    action: string,
    title: string,
    description: string,
    decision?: ActionForm["decision"],
  ) =>
    onAction({ action, title, description, supplier: supplier.key, decision });
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div className="inspector-eyebrow">
          <span>선택한 공급 대안</span>
          <Badge variant="outline">{supplier.name}</Badge>
        </div>
        <div className="inspector-product">
          <div>
            <h2 id="inspector-title" tabIndex={-1}>
              PSU-{supplier.key}
            </h2>
            <p>전원 모듈 · {supplier.proposals.at(-1)?.outputW ?? 0} W</p>
            <Badge
              variant={config.state === "approved" ? "secondary" : "outline"}
            >
              {config.state === "approved" ? "구성 승인" : "검토 진행"}
            </Badge>
          </div>
          <ServerIllustration small />
        </div>
      </div>
      <Tabs
        value={panel}
        onValueChange={(value) => onPanelChange(value as typeof panel)}
      >
        <TabsList variant="line" className="w-full">
          <TabsTrigger value="review">
            <ClipboardCheck />
            검토
          </TabsTrigger>
          <TabsTrigger value="discussion" disabled={!allowed("message.send")}>
            <MessageSquare />
            협의
          </TabsTrigger>
          <TabsTrigger value="files" disabled={!allowed("message.send")}>
            <Paperclip />
            자료
          </TabsTrigger>
        </TabsList>
        <TabsContent value="review">
          <div className="inspector-body">
            <p className="section-kicker">선정에 필요한 조건</p>
            {(
              [
                ["technical", "기술 검토", FileCheck2, "review.technical"],
                ["quality", "품질 검토", ShieldCheck, "review.quality"],
              ] as const
            ).map(([key, label, Icon, action]) => (
              <div
                className="review-step"
                key={key}
                data-complete={config[key].state === "approved"}
              >
                <div className="review-icon">
                  <Icon size={17} />
                </div>
                <div className="review-step-text">
                  <strong>{label}</strong>
                  <span>{reviewLabels[config[key].state]}</span>
                </div>
                {allowed(action) && config[key].state !== "approved" ? (
                  <div className="review-step-actions">
                    {config[key].state === "reviewing" ? (
                      <>
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={pending}
                          onClick={() =>
                            open(
                              action,
                              `${label} 승인`,
                              "해당 구성과 근거를 확인한 뒤 승인합니다.",
                              "approve",
                            )
                          }
                        >
                          승인
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={pending}
                          onClick={() =>
                            open(
                              action,
                              `${label} 반려`,
                              "반려 이유를 기록하고 재검토를 요청합니다.",
                              "reject",
                            )
                          }
                        >
                          반려
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          open(
                            action,
                            `${label} 시작`,
                            "검토 자료와 범위를 기록합니다.",
                            "start",
                          )
                        }
                      >
                        시작
                      </Button>
                    )}
                  </div>
                ) : config[key].state === "approved" ? (
                  <Check size={16} className="status-success" />
                ) : null}
              </div>
            ))}
            <div
              className="review-step"
              data-complete={config.state === "approved"}
            >
              <div className="review-icon">
                <GitBranch size={17} />
              </div>
              <div className="review-step-text">
                <strong>구성 승인</strong>
                <span>
                  C{config.revision}-{supplier.key} ·{" "}
                  {config.state === "approved" ? "승인" : "검토 중"}
                </span>
              </div>
              {allowed("configuration.approve") &&
                config.state !== "approved" && (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={
                      pending ||
                      config.technical.state !== "approved" ||
                      config.quality.state !== "approved"
                    }
                    onClick={() =>
                      open(
                        "configuration.approve",
                        "구성 승인",
                        "기술·품질 승인과 적용 규칙을 확인합니다.",
                      )
                    }
                  >
                    승인
                  </Button>
                )}
              {config.state === "approved" && (
                <Check size={16} className="status-success" />
              )}
            </div>
            <div
              className="review-step"
              data-complete={supplier.commitment?.status === "confirmed"}
            >
              <div className="review-icon">
                <Truck size={17} />
              </div>
              <div className="review-step-text">
                <strong>공급 확약</strong>
                <span>
                  {supplier.commitment?.status === "confirmed"
                    ? `${supplier.commitment.quantity}개 확인`
                    : supplier.commitment?.status === "submitted"
                      ? "확약 제출 · 확인 대기"
                      : "제출 필요"}
                </span>
              </div>
              {allowed("commitment.confirm") &&
                supplier.commitment?.status === "submitted" && (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      open(
                        "commitment.confirm",
                        "공급 확약 확인",
                        "선택한 제안의 물량·기간과 공급사의 확약을 확인합니다.",
                      )
                    }
                  >
                    확인
                  </Button>
                )}
              {supplier.commitment?.status === "confirmed" && (
                <Check size={16} className="status-success" />
              )}
            </div>
            {supplier.readiness && (
              <Alert>
                <AlertTitle>
                  {supplier.readiness.ready
                    ? "선정 조건 충족"
                    : "필수 조건 확인 중"}
                </AlertTitle>
                <AlertDescription>
                  {supplier.readiness.ready
                    ? `가용 ${supplier.readiness.available}개 · 기선정 ${supplier.readiness.assigned}개`
                    : supplier.readiness.reasons[0]}
                </AlertDescription>
              </Alert>
            )}
            <dl className="spec-list">
              <div>
                <dt>공개 사양</dt>
                <dd>{supplier.request.specification}</dd>
              </div>
              <div>
                <dt>요구 전압</dt>
                <dd>{workspace.requirement.voltage} V</dd>
              </div>
              <div>
                <dt>요구 출력</dt>
                <dd>{workspace.requirement.outputW} W 이상</dd>
              </div>
              <div>
                <dt>공급 가능일</dt>
                <dd>
                  {supplier.commitment
                    ? formatDate(supplier.commitment.availableAt)
                    : "미확인"}
                </dd>
              </div>
            </dl>
            <div className="inspector-actions">
              {allowed("allocation.other") && (
                <Button
                  variant="outline"
                  onClick={() =>
                    open(
                      "allocation.other",
                      "공유 물량 배분",
                      "다른 프로젝트에 배분한 물량은 이 프로젝트의 가용량에서 제외합니다.",
                    )
                  }
                >
                  타 프로젝트 배분 관리
                </Button>
              )}
              {allowed("commitment.submit") && (
                <Button
                  onClick={() =>
                    open(
                      "commitment.submit",
                      "공급 확약 제출",
                      "현재 제안에 적용되는 공급 물량과 날짜를 제출합니다.",
                    )
                  }
                >
                  공급 확약 제출
                </Button>
              )}
              {allowed("commitment.reduce") && (
                <Button
                  variant="outline"
                  onClick={() =>
                    open(
                      "commitment.reduce",
                      "공급 감소 통보",
                      "감소분을 가용량에 반영하며 기존 선정 이력은 보존합니다.",
                    )
                  }
                >
                  공급 감소 통보
                </Button>
              )}
              {allowed("design.revise") && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    open(
                      "design.revise",
                      "설계 변경과 재검토",
                      "새 요구조건과 구성 개정을 만들고 영향을 받는 승인을 다시 검토합니다.",
                    )
                  }
                >
                  설계 변경 검토
                  <ArrowRight data-icon="inline-end" />
                </Button>
              )}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="discussion">
          <Discussion workspace={workspace} supplier={supplier} act={act} />
        </TabsContent>
        <TabsContent value="files">
          <Files supplier={supplier} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
function Discussion({
  workspace,
  supplier,
  act,
}: {
  workspace: Workspace;
  supplier: SupplierView;
  act: Act;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false);
  const messages = workspace.messages.filter((m) => m.channel === supplier.key);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await act("message.send", { channel: supplier.key, text });
      setText("");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="discussion">
      <Marker>
        <MarkerContent>{supplier.name}와 구매기업의 개별 협의</MarkerContent>
      </Marker>
      <div className="discussion-messages">
        <MessageScrollerProvider autoScroll>
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent>
                {messages.map((message) => (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    <Message
                      align={
                        message.author === workspace.actor.name
                          ? "end"
                          : "start"
                      }
                    >
                      <MessageContent>
                        <MessageHeader>{message.author}</MessageHeader>
                        <Bubble
                          variant={
                            message.author === workspace.actor.name
                              ? "default"
                              : "muted"
                          }
                          align={
                            message.author === workspace.actor.name
                              ? "end"
                              : "start"
                          }
                        >
                          <BubbleContent>{message.text}</BubbleContent>
                        </Bubble>
                        <MessageFooter>{formatDate(message.at)}</MessageFooter>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      </div>
      <form onSubmit={send}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="discussion-text">협의 내용</FieldLabel>
            <Textarea
              id="discussion-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="사양·자료·조건을 협의하세요."
              maxLength={4000}
              required
            />
          </Field>
        </FieldGroup>
        <div className="message-send">
          <span>공개 대상: {supplier.name}</span>
          <Button
            size="sm"
            type="submit"
            disabled={busy || !workspace.actions.includes("message.send")}
          >
            <Send data-icon="inline-start" />
            보내기
          </Button>
        </div>
      </form>
    </div>
  );
}
function Files({ supplier }: { supplier: SupplierView }) {
  const client = useQueryClient(),
    input = useRef<HTMLInputElement>(null);
  const files = useQuery({
    queryKey: ["files", supplier.key],
    queryFn: () =>
      api<Array<{ id: string; name: string; bytes: number }>>(
        `/files?channel=${supplier.key}`,
      ),
    refetchInterval: 2000,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 1024 * 1024)
        throw new Error("1 MB 이하의 파일을 사용하세요.");
      return api("/files", {
        channel: supplier.key,
        requestId: crypto.randomUUID(),
        name: file.name,
        mime: file.type || "text/plain",
        content: await fileContent(file, true),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["files"] });
      toast.success("자료를 공유했습니다.");
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="inspector-body">
      <p className="section-kicker">공개 대상: {supplier.name}</p>
      <input
        ref={input}
        type="file"
        hidden
        accept=".pdf,.txt,.png,.jpg,.jpeg"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        disabled={upload.isPending}
        onClick={() => input.current?.click()}
      >
        <Upload data-icon="inline-start" />
        검증 자료 추가
      </Button>
      <p className="muted-note">PDF·텍스트·이미지, 파일당 1 MB 이하</p>
      {files.data?.length ? (
        files.data.map((file) => (
          <Attachment key={file.id} className="w-full">
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{file.name}</AttachmentTitle>
              <AttachmentDescription>
                {Math.ceil(file.bytes / 1024)} KB · 공유 자료
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction asChild aria-label={`${file.name} 다운로드`}>
                <a href={`/api/files/${file.id}`}>
                  <ArrowDownToLine />
                </a>
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Paperclip />
            </EmptyMedia>
            <EmptyTitle>공유한 자료가 없습니다.</EmptyTitle>
            <EmptyDescription>
              선택한 공급사와 검증 근거를 공유하세요.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {files.error && (
        <Alert variant="destructive">
          <AlertDescription>{files.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function Compare({
  workspace,
  onAction,
  onSelect,
}: {
  workspace: Workspace;
  onAction: (form: ActionForm) => void;
  onSelect: (key: SupplierKey) => void;
}) {
  return (
    <div className="table-panel">
      <div className="table-toolbar">
        <div>
          <h2>
            {workspace.actor.supplier ? "제안과 협의 이력" : "공급 대안 비교"}
          </h2>
          <p>요청·구성·제안의 개정을 함께 확인합니다.</p>
        </div>
      </div>
      {workspace.suppliers.map((c) => (
        <Card key={c.key} className="proposal-card">
          <CardHeader>
            <div className="row-between">
              <CardTitle>
                <Button variant="link" onClick={() => onSelect(c.key)}>
                  {c.name} · PSU-{c.key}
                </Button>
              </CardTitle>
              <Badge variant={c.readiness?.ready ? "secondary" : "outline"}>
                {c.configuration.state === "approved" ? "구성 승인" : "검토 중"}
              </Badge>
            </div>
            <CardDescription>
              {c.request.specification} · 요청 {c.request.quantity}개
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>회차</TableHead>
                  <TableHead>구분</TableHead>
                  <TableHead>수량</TableHead>
                  <TableHead>단가</TableHead>
                  <TableHead>공급일</TableHead>
                  <TableHead>유효일까지</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.proposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>v{p.revision}</TableCell>
                    <TableCell>
                      {p.kind === "offer" ? "공급사 제안" : "역제안"}
                    </TableCell>
                    <TableCell>{p.quantity}개</TableCell>
                    <TableCell>
                      {p.unitPriceCents === undefined
                        ? "공개 범위 외"
                        : money(p.unitPriceCents)}
                    </TableCell>
                    <TableCell>{formatDate(p.availableAt)}</TableCell>
                    <TableCell>{formatDate(p.validUntil)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {workspace.actor.supplier &&
              c.publishedAwards.map((award) => (
                <Alert key={award.id} className="mt-4">
                  <AlertTitle>게시된 선정 · {award.quantity}개</AlertTitle>
                  <AlertDescription>
                    구성 C{award.configRevision} · 제안 v
                    {c.proposals.find((p) => p.id === award.proposalId)
                      ?.revision ?? "이력 확인"}{" "}
                    ·{" "}
                    {award.unitPriceCents === undefined
                      ? ""
                      : money(award.unitPriceCents)}{" "}
                    · {formatDate(award.at)}
                  </AlertDescription>
                </Alert>
              ))}
          </CardContent>
          <CardFooter className="gap-2">
            {workspace.actions.includes("request.issue") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onAction({
                    action: "request.issue",
                    supplier: c.key,
                    title: "요청 개정 발행",
                    description:
                      "현재 사양을 공급사에 발행합니다. 이전 요청·제안은 보존합니다.",
                  })
                }
              >
                요청 개정
              </Button>
            )}
            {workspace.actions.includes("proposal.counter") && (
              <Button
                size="sm"
                onClick={() =>
                  onAction({
                    action: "proposal.counter",
                    supplier: c.key,
                    title: "역제안 작성",
                    description:
                      "변경된 상업 조건은 공급사의 새 제안으로 확인해야 합니다.",
                  })
                }
              >
                역제안 작성
              </Button>
            )}
            {workspace.actions.includes("proposal.submit") && (
              <Button
                size="sm"
                onClick={() =>
                  onAction({
                    action: "proposal.submit",
                    supplier: c.key,
                    title: "제안 제출",
                    description:
                      "요청 사양과 현재 구성에 적용되는 조건을 새 버전으로 제출합니다.",
                  })
                }
              >
                새 제안 제출
              </Button>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
export function Awards({
  workspace,
  act,
  onAction,
  pending,
}: {
  workspace: Workspace;
  act: Act;
  onAction: (form: ActionForm) => void;
  pending: boolean;
}) {
  const [history, setHistory] = useState<Workspace | null>(null);
  const logs = useQuery({
    queryKey: ["history", workspace.actor.id, workspace.version],
    queryFn: () =>
      api<Array<{ version: number; action: string; created_at: string }>>(
        "/history",
      ),
    enabled: workspace.awards !== undefined,
  });
  const open = (
    action: string,
    id: string,
    title: string,
    description: string,
    supplier?: SupplierKey,
  ) => onAction({ action, id, title, description, supplier });
  return (
    <div className="table-panel">
      <div className="table-toolbar">
        <div>
          <h2>선정과 결정 근거</h2>
          <p>승인된 수량과 현재 조달 조건을 각각 보존합니다.</p>
        </div>
      </div>
      {!workspace.awards?.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCheck />
            </EmptyMedia>
            <EmptyTitle>아직 선정안이 없습니다.</EmptyTitle>
            <EmptyDescription>
              유효 물량을 확인한 뒤 상단의 선정안 작성을 실행하세요.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {workspace.awards?.map((a) => (
        <Card key={a.id} className="proposal-card">
          <CardHeader>
            <div className="row-between">
              <CardTitle>
                {a.lines.reduce((sum, l) => sum + l.quantity / 2, 0)}대분 선정안
              </CardTitle>
              <Badge
                variant={
                  a.state === "approved"
                    ? "secondary"
                    : a.state === "rejected"
                      ? "destructive"
                      : "outline"
                }
              >
                {a.state === "approved"
                  ? "선정 승인"
                  : a.state === "rejected"
                    ? "반려"
                    : "승인 요청"}
              </Badge>
            </div>
            <CardDescription>
              {a.createdBy} · {formatDate(a.createdAt)} · {a.id.slice(0, 8)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="spec-list">
              {a.lines.map((line) => (
                <div key={line.supplier}>
                  <dt>
                    공급사 {line.supplier} · C{line.configRevision}
                  </dt>
                  <dd>
                    {line.quantity}개 · {money(line.unitPriceCents)}
                  </dd>
                </div>
              ))}
              <div>
                <dt>잔여 담당자</dt>
                <dd>{workspace.shortageOwner}</dd>
              </div>
            </dl>
            {a.reason && <p>{a.reason}</p>}
            {a.snapshot != null && (
              <details>
                <summary>승인 당시의 버전과 근거</summary>
                <pre className="evidence-json">
                  {JSON.stringify(a.snapshot, null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
          <CardFooter className="gap-2 flex-wrap">
            {a.state === "requested" &&
              workspace.actions.includes("award.approve") && (
                <>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      open(
                        "award.approve",
                        a.id,
                        "선정 승인",
                        "승인 시점의 조건과 가용량을 다시 검사하고 배분을 확정합니다.",
                      )
                    }
                  >
                    선정 승인
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      open(
                        "award.reject",
                        a.id,
                        "선정안 반려",
                        "반려 이유를 남기고 수정된 선정안을 요청합니다.",
                      )
                    }
                  >
                    반려
                  </Button>
                </>
              )}
            {a.state === "approved" &&
              a.lines.map((line) =>
                a.published.includes(line.supplier) ? (
                  <Badge key={line.supplier} variant="secondary">
                    {line.supplier} 결과 게시됨
                  </Badge>
                ) : workspace.actions.includes("award.publish") ? (
                  <Button
                    key={line.supplier}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      open(
                        "award.publish",
                        a.id,
                        `${line.supplier}에 선정 결과 게시`,
                        "해당 공급사의 선정 물량과 조건만 게시합니다.",
                        line.supplier,
                      )
                    }
                  >
                    {line.supplier}에 결과 게시
                  </Button>
                ) : null,
              )}
            {a.state === "approved" &&
              a.lines.every((l) => a.published.includes(l.supplier)) &&
              !a.handedOffAt &&
              workspace.actions.includes("award.handoff") && (
                <Button
                  size="sm"
                  onClick={() =>
                    open(
                      "award.handoff",
                      a.id,
                      "선정 결과 인계",
                      "다운로드할 결정 스냅샷의 인계 이력을 기록합니다.",
                    )
                  }
                >
                  인계 기록
                </Button>
              )}
            {a.handedOffAt && (
              <Button variant="outline" asChild size="sm">
                <a href={`/api/handoff/${a.id}`}>
                  <ArrowDownToLine data-icon="inline-start" />
                  인계 파일
                </a>
              </Button>
            )}
          </CardFooter>
        </Card>
      ))}
      {logs.data?.length ? (
        <details className="history-details">
          <summary>과거 업무 상태 조회 · {logs.data.length}개 기록</summary>
          <div className="history-entries">
            {logs.data.map((log) => (
              <Button
                variant="outline"
                key={log.version}
                size="sm"
                onClick={async () => {
                  try {
                    const result = await api<{ workspace: Workspace }>(
                      `/history/${log.version}`,
                    );
                    setHistory(result.workspace);
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                v{log.version} · {log.action}
              </Button>
            ))}
          </div>
        </details>
      ) : null}
      {history && (
        <Dialog open onOpenChange={() => setHistory(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>과거 업무 상태 · v{history.version}</DialogTitle>
              <DialogDescription>
                당시 저장한 버전입니다. 현재 상태를 변경하지 않습니다.
              </DialogDescription>
            </DialogHeader>
            <pre className="evidence-json">
              {JSON.stringify(history, null, 2)}
            </pre>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export function SettingsDialog({
  workspace,
  onClose,
  refresh,
  act,
}: {
  workspace: Workspace;
  onClose: () => void;
  refresh: () => Promise<unknown>;
  act: Act;
}) {
  const [mapping, setMapping] = useState<BomMapping>(() =>
      structuredClone(workspace.mappings![0]),
    ),
    [input, setInput] = useState<{
      content: string;
      format: "csv" | "xlsx";
      name: string;
    } | null>(null);
  const [preview, setPreview] = useState<{
      headers: string[];
      rows: BomRow[];
      total: number;
      errors: Array<{ row: number; field: string; message: string }>;
      errorCount: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [customKey, setCustomKey] = useState(""),
    [customColumn, setCustomColumn] = useState("");
  const file = useRef<HTMLInputElement>(null);
  async function readFile(picked: File) {
    setError("");
    setPreview(null);
    try {
      const format = picked.name.toLowerCase().endsWith(".xlsx")
        ? "xlsx"
        : "csv";
      setInput({
        content: await fileContent(picked, format === "xlsx"),
        format,
        name: picked.name,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function validate(publish = false) {
    if (!input) return;
    setBusy(true);
    setError("");
    try {
      if (publish) {
        await api("/bom/publish", {
          content: input.content,
          format: input.format,
          mapping,
          expectedVersion: workspace.version,
          requestId: crypto.randomUUID(),
        });
        await refresh();
        toast.success("새 BOM과 설정 버전을 발행했습니다.");
        onClose();
      } else
        setPreview(
          await api("/bom/preview", {
            content: input.content,
            format: input.format,
            mapping,
          }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>BOM 설정과 서버 Extension</DialogTitle>
          <DialogDescription>
            기업의 열 이름과 규칙을 설정하고 검증한 버전을 발행합니다.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="bom">
          <TabsList>
            <TabsTrigger value="bom">BOM 양식</TabsTrigger>
            <TabsTrigger value="extension">서버 규칙</TabsTrigger>
          </TabsList>
          <TabsContent value="bom">
            <div className="settings-body">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="mapping-template">기준 양식</FieldLabel>
                  <NativeSelect
                    id="mapping-template"
                    value={mapping.id}
                    onChange={(e) => {
                      setMapping(
                        structuredClone(
                          workspace.mappings!.find(
                            (m) => m.id === e.target.value,
                          )!,
                        ),
                      );
                      setPreview(null);
                    }}
                  >
                    <NativeSelectOption value="system">
                      서버 시스템 BOM
                    </NativeSelectOption>
                    <NativeSelectOption value="board">
                      시스템 보드 BOM
                    </NativeSelectOption>
                    <NativeSelectOption value="power">
                      전원 모듈 BOM
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
              </FieldGroup>
              <div className="settings-upload">
                <input
                  hidden
                  ref={file}
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) void readFile(picked);
                  }}
                />
                <Button variant="outline" onClick={() => file.current?.click()}>
                  <Upload data-icon="inline-start" />
                  {input?.name ?? "BOM 파일 선택"}
                </Button>
                <Button variant="ghost" asChild>
                  <a href={`/api/bom/template/${mapping.id}`}>
                    <ArrowDownToLine data-icon="inline-start" />
                    모의 양식
                  </a>
                </Button>
              </div>
              <p className="muted-note">
                CSV 또는 값으로 구성된 단일 시트 XLSX · 2 MB 이하 · 수량 기준은
                상위 품목 1개당입니다.
              </p>
              <div className="mapping-grid">
                <FieldGroup>
                  {Object.entries(mapping.columns).map(([key, column]) => (
                    <Field key={key} orientation="horizontal">
                      <FieldLabel htmlFor={`map-${key}`}>{key}</FieldLabel>
                      <Input
                        id={`map-${key}`}
                        value={column}
                        onChange={(e) => {
                          setMapping({
                            ...mapping,
                            columns: {
                              ...mapping.columns,
                              [key]: e.target.value,
                            },
                          });
                          setPreview(null);
                        }}
                      />
                    </Field>
                  ))}
                </FieldGroup>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="unit-alias">
                      EA로 변환할 단위 이름
                    </FieldLabel>
                    <Input
                      id="unit-alias"
                      value={Object.keys(mapping.unitMap).join(", ")}
                      onChange={(e) => {
                        setMapping({
                          ...mapping,
                          unitMap: Object.fromEntries(
                            e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean)
                              .map((unit) => [unit, "EA"]),
                          ),
                        });
                        setPreview(null);
                      }}
                    />
                    <FieldDescription>
                      쉼표로 구분합니다. 다른 차원의 단위를 자동 환산하지
                      않습니다.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="column-order">
                      표시할 필드 순서
                    </FieldLabel>
                    <Input
                      id="column-order"
                      value={mapping.visibleColumns.join(", ")}
                      onChange={(e) => {
                        setMapping({
                          ...mapping,
                          visibleColumns: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        });
                        setPreview(null);
                      }}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="required-fields">필수 필드</FieldLabel>
                    <Input
                      id="required-fields"
                      value={mapping.required.join(", ")}
                      onChange={(e) => {
                        setMapping({
                          ...mapping,
                          required: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        });
                        setPreview(null);
                      }}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="shared-fields">
                      공급사 공개 허용 필드
                    </FieldLabel>
                    <Input
                      id="shared-fields"
                      value={mapping.sharedFields.join(", ")}
                      onChange={(e) => {
                        setMapping({
                          ...mapping,
                          sharedFields: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        });
                        setPreview(null);
                      }}
                    />
                    <FieldDescription>
                      공개 요청의 지원 필드 안에서만 설정합니다. 원본 전체 BOM은
                      공유하지 않습니다.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="custom-key">추가 속성</FieldLabel>
                    <Input
                      id="custom-key"
                      placeholder="예: certification"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                    />
                    <Input
                      aria-label="추가 속성의 원본 열"
                      placeholder="원본 열 이름"
                      value={customColumn}
                      onChange={(e) => setCustomColumn(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      type="button"
                      disabled={!customKey || !customColumn}
                      onClick={() => {
                        setMapping({
                          ...mapping,
                          columns: {
                            ...mapping.columns,
                            [`attr.${customKey}`]: customColumn,
                          },
                        });
                        setCustomKey("");
                        setCustomColumn("");
                        setPreview(null);
                      }}
                    >
                      속성 매핑 추가
                    </Button>
                  </Field>
                </FieldGroup>
              </div>
              {preview && (
                <Alert variant={preview.errorCount ? "destructive" : "default"}>
                  <AlertTitle>
                    {preview.errorCount
                      ? `${preview.errorCount}개 검증 오류`
                      : `${preview.total}개 행 검증 완료`}
                  </AlertTitle>
                  <AlertDescription>
                    {preview.errors.length ? (
                      <ul>
                        {preview.errors.slice(0, 8).map((e, i) => (
                          <li key={i}>
                            {e.row}행 · {e.field}: {e.message}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "계층·필수 의미·수량·단위를 확인했습니다. 발행하면 새 개정과 재검토가 생성됩니다."
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="settings-footer">
                <Button
                  variant="outline"
                  disabled={!input || busy}
                  onClick={() => void validate()}
                >
                  변환·검증
                </Button>
                <Button
                  disabled={!preview || preview.errorCount > 0 || busy}
                  onClick={() => void validate(true)}
                >
                  {busy && (
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  )}
                  설정과 BOM 발행
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="extension">
            <form
              className="settings-body"
              onSubmit={async (e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                setBusy(true);
                try {
                  await act("extension.configure", {
                    version: String(data.get("version")),
                    enabled: data.get("enabled") === "true",
                    minOutputW: Number(data.get("minOutputW")),
                  });
                  await refresh();
                  onClose();
                } catch {
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Alert>
                <ShieldCheck />
                <AlertTitle>server-power-rules</AlertTitle>
                <AlertDescription>
                  전압·출력·구성 개정의 모의 규칙입니다. 변경하면 새 검토가
                  생성됩니다.
                </AlertDescription>
              </Alert>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="extension-version">
                    규칙 패키지 버전
                  </FieldLabel>
                  <NativeSelect
                    id="extension-version"
                    name="version"
                    defaultValue={workspace.extension?.version}
                  >
                    <NativeSelectOption value="1.0.0">1.0.0</NativeSelectOption>
                    <NativeSelectOption value="1.1.0">1.1.0</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="extension-enabled">신규 사용</FieldLabel>
                  <NativeSelect
                    id="extension-enabled"
                    name="enabled"
                    defaultValue={String(workspace.extension?.enabled)}
                  >
                    <NativeSelectOption value="true">활성화</NativeSelectOption>
                    <NativeSelectOption value="false">
                      비활성화 · 미검증 처리
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
                <FormField
                  name="minOutputW"
                  label="이 기업의 최소 출력 (W)"
                  type="number"
                  min={1}
                  initial={workspace.extension?.minOutputW}
                />
              </FieldGroup>
              <div className="settings-footer">
                <Button type="submit" disabled={busy}>
                  규칙 설정 발행
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
export function FactsDialog({
  workspace,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const facts = useQuery({
    queryKey: ["facts", workspace.actor.id, workspace.version],
    queryFn: () =>
      api<{
        reference: string;
        version: number;
        suppliers: Array<{ key: string; reasons?: string[] }>;
      }>("/facts"),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>변경 근거와 다음 검토</DialogTitle>
          <DialogDescription>
            {facts.data?.reference ?? "근거 조회 중"} · 업무 버전{" "}
            {workspace.version}
          </DialogDescription>
        </DialogHeader>
        <div className="facts-body">
          {workspace.metrics && (
            <dl className="spec-list">
              <div>
                <dt>현재 조달 충족</dt>
                <dd>
                  {workspace.metrics.coverage} / {workspace.target}대
                </dd>
              </div>
              <div>
                <dt>선정 승인</dt>
                <dd>
                  {workspace.metrics.selected} / {workspace.target}대
                </dd>
              </div>
              <div>
                <dt>현재 부족분</dt>
                <dd>
                  {workspace.metrics.shortage}대분 · {workspace.shortageOwner}
                </dd>
              </div>
            </dl>
          )}
          {workspace.suppliers.map((c) => (
            <div key={c.key}>
              <h3>
                {c.name} · C{c.configuration.revision}
              </h3>
              <p className="muted-note">
                {c.request.specification} · 기술{" "}
                {reviewLabels[c.configuration.technical.state]} · 품질{" "}
                {reviewLabels[c.configuration.quality.state]}
              </p>
              {c.readiness?.reasons.length ? (
                <ul className="reason-list">
                  {c.readiness.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : (
                <p>공개된 조건과 상태를 확인하세요.</p>
              )}
            </div>
          ))}
          <p className="muted-note">
            저장된 상태와 규칙에서 계산한 근거입니다. 각 결정의 기준 개정과 검토
            기록을 확인할 수 있습니다.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
