import { EventType, type BaseEvent } from "@ag-ui/core";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ensure } from "./domain.js";
import type { Workspace } from "../shared/model.js";
import type { Navigation } from "../shared/navigation.js";

export function readNavigationInput(body: unknown) {
  const parsed = RunAgentInputSchema.safeParse(body);
  ensure(parsed.success, "탐색 요청 형식을 확인하세요.", 400);
  const input = parsed.data;
  ensure(
    input.threadId.length <= 100 &&
      input.runId.length <= 100 &&
      input.messages.length === 1 &&
      input.messages[0].role === "user" &&
      typeof input.messages[0].content === "string",
    "한 개의 탐색 명령을 입력하세요.",
    400,
  );
  ensure(
    input.tools.length === 0 &&
      input.context.length === 0 &&
      !input.resume?.length,
    "지원하는 탐색 명령만 사용할 수 있습니다.",
    400,
  );
  const command = z
    .string()
    .trim()
    .min(1)
    .max(160)
    .parse(input.messages[0].content);
  const props = z
    .object({ selectedSupplier: z.enum(["A", "B"]) })
    .strict()
    .parse(input.forwardedProps);
  return {
    threadId: input.threadId,
    runId: input.runId,
    command,
    selectedSupplier: props.selectedSupplier,
  };
}

export function resolveNavigation(
  command: string,
  selectedSupplier: string,
  view: Workspace,
): { navigation: Navigation; message: string } {
  const normalized = command
    .trim()
    .toUpperCase()
    .replace(/[.!?。]+$/, "")
    .trim();
  const match =
    /^(?:(?:공급사\s*|PSU[-\s]*)?([A-Z])|(?:현재|선택한)\s*(?:공급사|대안)?)\s*(?:의\s*)?(검토|협의|자료)(?:\s*(?:열어\s*줘|열기|보여\s*줘|보기))?$/.exec(
      normalized,
    );
  ensure(
    match,
    "공급사와 검토·협의·자료를 지정하세요. 예: 현재 대안 검토 열어줘",
    422,
  );
  const supplier = view.suppliers.find(
    (c) => c.key === (match[1] ?? selectedSupplier),
  );
  ensure(supplier, "열 수 있는 공급 대안을 찾지 못했습니다.", 404);
  const panel = (
    { 검토: "review", 협의: "discussion", 자료: "files" } as const
  )[match[2] as "검토" | "협의" | "자료"];
  ensure(
    panel === "review" || view.actions.includes("message.send"),
    "이 협의 자료를 열 권한이 없습니다.",
    403,
  );
  return {
    navigation: {
      actorId: view.actor.id,
      sourceVersion: view.version,
      supplier: supplier.key,
      tab: "map",
      panel,
    },
    message: `${supplier.name}의 관계도와 ${match[2]} 패널을 열었습니다.`,
  };
}

export function navigationEvents(
  input: ReturnType<typeof readNavigationInput>,
  view: Workspace,
): BaseEvent[] {
  const { navigation, message } = resolveNavigation(
    input.command,
    input.selectedSupplier,
    view,
  );
  const messageId = randomUUID();
  return [
    { type: EventType.STEP_FINISHED, stepName: "대상과 공개 범위 확인" },
    { type: EventType.STATE_SNAPSHOT, snapshot: navigation },
    { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: message },
    { type: EventType.TEXT_MESSAGE_END, messageId },
    {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    },
  ];
}
