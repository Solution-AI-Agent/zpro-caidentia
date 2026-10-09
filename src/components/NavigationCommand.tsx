import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import type { HttpAgent } from "@ag-ui/client";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Compass,
  LoaderCircle,
  MessageSquare,
  Square,
  X,
} from "lucide-react";
import { navigationSchema, type Navigation } from "../shared/navigation";
import type { SupplierKey, Workspace } from "../shared/model";
import { csrfHeaders } from "../lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "./ui/message";
import { Bubble, BubbleContent } from "./ui/bubble";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "./ui/message-scroller";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import { Marker, MarkerContent, MarkerIcon } from "./ui/marker";

type ChatTurn = {
  id: number;
  command: string;
  reply: string;
  status: "pending" | "complete" | "error" | "cancelled";
};

export function NavigationCommand({
  workspace,
  selected,
  open,
  onOpenChange,
  onNavigate,
  reduceMotion,
}: {
  workspace: Workspace;
  selected: SupplierKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (navigation: Navigation) => void;
  reduceMotion: boolean;
}) {
  const [command, setCommand] = useState(""),
    [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 1280px)").matches,
  );
  const active = useRef<HttpAgent | null>(null),
    generation = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null),
    focusWorkspace = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      active.current?.abortRun();
    },
    [],
  );
  function reply(id: number, status: ChatTurn["status"], text: string) {
    setTurns((current) =>
      current.map((turn) =>
        turn.id === id ? { ...turn, status, reply: text } : turn,
      ),
    );
  }
  function cancel() {
    const id = generation.current++;
    active.current?.abortRun();
    active.current = null;
    setPending(false);
    setFailed(false);
    reply(id, "cancelled", "탐색을 취소했습니다. 현재 화면을 유지합니다.");
  }
  function changeOpen(value: boolean) {
    if (!value && pending) cancel();
    onOpenChange(value);
  }
  async function run(text: string) {
    if (pending || !text.trim()) return;
    const operation = ++generation.current;
    setCommand("");
    setPending(true);
    setFailed(false);
    setTurns((current) => [
      ...current,
      { id: operation, command: text, reply: "", status: "pending" },
    ]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const { HttpAgent } = await import("@ag-ui/client");
      if (operation !== generation.current) return;
      const agent = new HttpAgent({
        url: "/api/navigation",
        threadId: crypto.randomUUID(),
        headers: csrfHeaders(),
        initialMessages: [
          { id: crypto.randomUUID(), role: "user", content: text },
        ],
        fetch: async (url, init) => {
          const response = await fetch(url, {
            ...init,
            credentials: "same-origin",
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(
              body?.message ?? "탐색 요청을 처리하지 못했습니다.",
            );
          }
          return response;
        },
      });
      active.current = agent;
      timeout = setTimeout(() => agent.abortRun(), 10000);
      let navigation: Navigation | undefined,
        message = "",
        protocolError = "",
        finished = false;
      await agent.runAgent(
        {
          runId: crypto.randomUUID(),
          forwardedProps: { selectedSupplier: selected },
        },
        {
          onStateSnapshotEvent: ({ event }) => {
            navigation = navigationSchema.parse(event.snapshot);
          },
          onTextMessageContentEvent: ({ event }) => {
            message += event.delta;
          },
          onRunErrorEvent: ({ event }) => {
            protocolError = event.message;
          },
          onRunFinishedEvent: () => {
            finished = true;
          },
        },
      );
      if (operation !== generation.current) return;
      if (protocolError) throw new Error(protocolError);
      if (!finished || !navigation)
        throw new Error("탐색이 완료되지 않았습니다. 다시 시도하세요.");
      if (
        navigation.actorId !== workspace.actor.id ||
        !workspace.suppliers.some((s) => s.key === navigation!.supplier)
      )
        throw new Error("공개 범위를 다시 확인하세요.");
      onNavigate(navigation);
      reply(operation, "complete", message);
    } catch (error) {
      if (operation === generation.current) {
        setFailed(true);
        reply(
          operation,
          "error",
          error instanceof Error
            ? error.message
            : "탐색을 완료하지 못했습니다.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (operation === generation.current) {
        active.current = null;
        setPending(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending && command.trim()) void run(command.trim());
  }
  return (
    <Sheet open={open} onOpenChange={changeOpen} modal={!wide}>
      <SheetTrigger asChild>
        <Button
          id="agui-chat-trigger"
          variant={open ? "secondary" : "outline"}
          size="sm"
        >
          <MessageSquare data-icon="inline-start" />
          D2S 챗
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="agui-drawer"
        data-reduced={reduceMotion}
        showCloseButton={false}
        onInteractOutside={(event) => {
          if (wide) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!focusWorkspace.current) return;
          event.preventDefault();
          focusWorkspace.current = false;
          const title =
            document.getElementById("inspector-title") ??
            document.getElementById("bom-current-title");
          title?.focus({ preventScroll: true });
          title?.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "center",
          });
        }}
      >
        <SheetHeader className="agui-chat-header">
          <div className="agui-chat-title-row">
            <Compass aria-hidden="true" />
            <SheetTitle>D2S 챗</SheetTitle>
            <Badge variant="secondary">AG-UI</Badge>
            <SheetClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="D2S 챗 닫기">
                <X />
              </Button>
            </SheetClose>
          </div>
          <SheetDescription>
            대화로 관계도와 상세 패널을 탐색하세요.
          </SheetDescription>
        </SheetHeader>
        <div className="agui-chat-context">
          <div>
            <span>현재 선택</span>
            <strong>PSU-{selected}</strong>
          </div>
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                focusWorkspace.current = true;
              }}
            >
              업무 화면 보기
              <ArrowUpRight data-icon="inline-end" />
            </Button>
          </SheetClose>
        </div>
        <div className="agui-chat-conversation">
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller>
              <MessageScrollerViewport aria-label="D2S 탐색 대화">
                <MessageScrollerContent
                  className="p-5"
                  aria-label="탐색 메시지"
                  aria-live="polite"
                >
                  {turns.length === 0 && (
                    <MessageScrollerItem messageId="welcome">
                      <Empty className="px-0 py-8">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Compass />
                          </EmptyMedia>
                          <EmptyTitle>어떤 대안을 살펴볼까요?</EmptyTitle>
                          <EmptyDescription>
                            공급사와 검토·협의·자료를 알려주세요.
                            <br />
                            관계도와 해당 패널을 함께 열어드립니다.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </MessageScrollerItem>
                  )}
                  {turns.map((turn) => (
                    <Fragment key={turn.id}>
                      <MessageScrollerItem
                        messageId={`user-${turn.id}`}
                        scrollAnchor
                      >
                        <Message align="end">
                          <MessageContent>
                            <MessageHeader>나</MessageHeader>
                            <Bubble align="end">
                              <BubbleContent>{turn.command}</BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                      <MessageScrollerItem messageId={`reply-${turn.id}`}>
                        <Message>
                          <MessageContent>
                            <MessageHeader>
                              <Compass
                                aria-hidden="true"
                                className="mr-1.5 size-3.5"
                              />
                              D2S 챗
                            </MessageHeader>
                            {turn.status === "pending" ? (
                              <Marker role="status">
                                <MarkerIcon>
                                  <LoaderCircle className="animate-spin" />
                                </MarkerIcon>
                                <MarkerContent>
                                  대상과 공개 범위를 확인하고 있습니다.
                                </MarkerContent>
                              </Marker>
                            ) : (
                              <Bubble
                                variant={
                                  turn.status === "error"
                                    ? "destructive"
                                    : "muted"
                                }
                              >
                                <BubbleContent>{turn.reply}</BubbleContent>
                              </Bubble>
                            )}
                            {turn.status === "complete" && (
                              <MessageFooter>
                                <Check
                                  aria-hidden="true"
                                  className="mr-1 size-3.5"
                                />
                                관계도와 패널에 적용됨
                              </MessageFooter>
                            )}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    </Fragment>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton
                aria-label="최근 메시지로 이동"
                behavior={reduceMotion ? "auto" : "smooth"}
              />
            </MessageScroller>
          </MessageScrollerProvider>
        </div>
        <div className="agui-chat-composer">
          <div className="agui-chat-examples" aria-label="탐색 명령 예시">
            {workspace.suppliers.map((s) => (
              <Button
                key={s.key}
                type="button"
                variant="outline"
                size="xs"
                disabled={pending}
                onClick={() => void run(`공급사 ${s.key} 검토 열어줘`)}
              >
                {s.name} 검토
              </Button>
            ))}
            {workspace.actions.includes("message.send") && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={pending}
                onClick={() => void run("현재 대안 협의 열어줘")}
              >
                현재 대안 협의
              </Button>
            )}
          </div>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={failed}>
                <FieldLabel className="sr-only" htmlFor="navigation-command">
                  탐색 메시지
                </FieldLabel>
                <Textarea
                  ref={input}
                  id="navigation-command"
                  placeholder={`공급사 ${selected} 검토 열어줘`}
                  value={command}
                  maxLength={160}
                  aria-invalid={failed}
                  aria-describedby="agui-command-help"
                  onChange={(event) => {
                    setCommand(event.target.value);
                    setFailed(false);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing &&
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="agui-chat-send-row">
                  <FieldDescription id="agui-command-help">
                    Enter 전송 · Shift+Enter 줄바꿈
                  </FieldDescription>
                  {pending ? (
                    <Button
                      key="cancel"
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.preventDefault();
                        cancel();
                      }}
                    >
                      <Square data-icon="inline-start" />
                      취소
                    </Button>
                  ) : (
                    <Button
                      key="send"
                      type="submit"
                      size="sm"
                      disabled={!command.trim()}
                    >
                      <ArrowUp data-icon="inline-start" />
                      전송
                    </Button>
                  )}
                </div>
              </Field>
            </FieldGroup>
          </form>
          <p className="agui-chat-scope">검토·협의·자료 탐색을 지원합니다.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
