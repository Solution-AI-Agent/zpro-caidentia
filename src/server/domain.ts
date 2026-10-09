import { randomUUID } from "node:crypto";
import { createActor, createMachine } from "xstate";
import { z } from "zod";
import { evaluateServerPower } from "./extensions/server-power.js";
import type {
  Actor,
  AwardLine,
  Collaboration,
  Command,
  Configuration,
  Project,
  Proposal,
  Readiness,
  Role,
  SupplierKey,
  Workspace,
} from "../shared/model.js";

export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  message: string,
  status = 422,
): asserts condition {
  if (!condition) throw new DomainError(status, message);
}
export const has = (actor: Actor, ...roles: Role[]) =>
  roles.some((role) => actor.roles.includes(role));
export const currentConfig = (c: Collaboration) => c.configurations.at(-1)!;
export const currentOffer = (c: Collaboration) => c.proposals.at(-1);
export const currentCommitment = (c: Collaboration) => c.commitments.at(-1);
const quantity = z.number().int().min(0).max(1000000);
const text = z.string().trim().min(1).max(4000);
const key = z.enum(["A", "B"]);
const date = z.iso.datetime({ offset: true });
const proposalSchema = z
  .object({
    supplier: key,
    quantity: quantity.min(2),
    minQuantity: quantity.min(2),
    unitPriceCents: quantity.min(1),
    availableAt: date,
    validUntil: date,
    voltage: z.number().int().min(1).max(1000),
    outputW: z.number().int().min(1).max(100000),
    note: z.string().max(4000).default(""),
  })
  .strict();
const schemas: Record<string, z.ZodType> = {
  "request.issue": z
    .object({ supplier: key, quantity: quantity.min(2) })
    .strict(),
  "proposal.submit": proposalSchema,
  "proposal.counter": proposalSchema,
  "review.technical": z
    .object({
      supplier: key,
      decision: z.enum(["start", "approve", "reject"]),
      evidence: text,
    })
    .strict(),
  "review.quality": z
    .object({
      supplier: key,
      decision: z.enum(["start", "approve", "reject"]),
      evidence: text,
    })
    .strict(),
  "configuration.approve": z.object({ supplier: key }).strict(),
  "commitment.submit": z
    .object({ supplier: key, quantity, availableAt: date })
    .strict(),
  "commitment.confirm": z.object({ supplier: key }).strict(),
  "commitment.reduce": z
    .object({ supplier: key, quantity, reason: text })
    .strict(),
  "allocation.other": z.object({ supplier: key, quantity }).strict(),
  "award.request": z
    .object({
      quantities: z.object({ A: quantity, B: quantity }).strict(),
      owner: text,
    })
    .strict(),
  "award.approve": z.object({ id: text }).strict(),
  "award.reject": z.object({ id: text, reason: text }).strict(),
  "award.publish": z.object({ id: text, supplier: key }).strict(),
  "award.handoff": z.object({ id: text }).strict(),
  "design.revise": z
    .object({
      voltage: z.number().int().min(1).max(1000),
      outputW: z.number().int().min(1).max(100000),
      reason: text,
    })
    .strict(),
  "message.send": z
    .object({ channel: z.enum(["A", "B", "internal"]), text })
    .strict(),
  "extension.configure": z
    .object({
      version: z.enum(["1.0.0", "1.1.0"]),
      enabled: z.boolean(),
      minOutputW: z.number().int().min(1).max(100000),
    })
    .strict(),
  "membership.revoke": z.object({ actorId: text }).strict(),
};
export const actionRoles: Record<string, Role[]> = {
  "request.issue": ["buyer"],
  "proposal.submit": ["supplier"],
  "proposal.counter": ["buyer"],
  "review.technical": ["designer"],
  "review.quality": ["quality"],
  "configuration.approve": ["designer"],
  "commitment.submit": ["supplier"],
  "commitment.confirm": ["buyer"],
  "commitment.reduce": ["supplier"],
  "allocation.other": ["buyer"],
  "award.request": ["buyer"],
  "award.approve": ["approver"],
  "award.reject": ["approver"],
  "award.publish": ["buyer"],
  "award.handoff": ["buyer"],
  "design.revise": ["designer"],
  "message.send": ["buyer", "approver", "supplier"],
  "extension.configure": ["admin"],
  "membership.revoke": ["admin"],
};
const titles: Record<string, string> = {
  "request.issue": "견적 요청 발행",
  "proposal.submit": "공급사 제안 제출",
  "proposal.counter": "역제안 작성",
  "review.technical": "기술 검토 갱신",
  "review.quality": "품질 검토 갱신",
  "configuration.approve": "구성 승인",
  "commitment.submit": "공급 확약 제출",
  "commitment.confirm": "공급 확약 확인",
  "commitment.reduce": "공급 감소 통보",
  "allocation.other": "공유 물량 배분 변경",
  "award.request": "선정 승인 요청",
  "award.approve": "선정 승인",
  "award.reject": "선정안 반려",
  "award.publish": "선정 결과 게시",
  "award.handoff": "선정 결과 인계",
  "design.revise": "설계 변경과 재검토 요청",
  "message.send": "협의 메시지",
  "extension.configure": "서버 규칙 설정 발행",
  "membership.revoke": "참여 권한 철회",
};
const reviewMachine = createMachine({
  id: "review",
  initial: "pending",
  states: {
    pending: { on: { START: "reviewing" } },
    reviewing: { on: { APPROVE: "approved", REJECT: "rejected" } },
    rejected: { on: { START: "reviewing" } },
    approved: {},
  },
});
function changeReview(state: string, event: string) {
  const actor = createActor(reviewMachine, {
    snapshot: reviewMachine.resolveState({ value: state, context: {} }),
  }).start();
  try {
    ensure(
      actor.getSnapshot().can({ type: event }),
      "현재 검토 상태에서 실행할 수 없습니다.",
    );
    actor.send({ type: event });
    return actor.getSnapshot().value as Configuration["technical"]["state"];
  } finally {
    actor.stop();
  }
}
export function checkAccess(project: Project, actor: Actor) {
  ensure(
    actor.active && !project.revokedActors.includes(actor.id),
    "참여 권한이 없습니다.",
    403,
  );
  ensure(actor.tenant === project.tenant, "대상을 찾을 수 없습니다.", 404);
  if (actor.supplier)
    ensure(
      project.suppliers[actor.supplier]?.org === actor.org,
      "대상을 찾을 수 없습니다.",
      404,
    );
}
export function versionFor(project: Project, actor: Actor) {
  return actor.supplier
    ? project.suppliers[actor.supplier].revision
    : project.version;
}
export function assigned(project: Project, supplier: SupplierKey) {
  return project.awards
    .filter((a) => a.state === "approved")
    .flatMap((a) => a.lines)
    .filter((l) => l.supplier === supplier)
    .reduce((sum, l) => sum + l.quantity, 0);
}

// A reviewed server Extension: pure input/output, no database or permission mutation.
export function evaluatePower(
  project: Project,
  c: Collaboration,
): { result: "passed" | "failed" | "unknown"; reasons: string[] } {
  return evaluateServerPower({
    ...project.requirement,
    ...project.extension,
    proposal: currentOffer(c),
  });
}
export function readiness(
  project: Project,
  c: Collaboration,
  now = Date.now(),
): Readiness {
  const config = currentConfig(c),
    offer = currentOffer(c),
    commitment = currentCommitment(c);
  const rule = evaluatePower(project, c),
    reasons = [...rule.reasons];
  if (
    config.requirementRevision !== project.requirement.revision ||
    config.bomRevision !== project.bomRevision ||
    config.policyRevision !== project.extension.revision
  )
    reasons.push("현재 기준 버전으로 재검토가 필요합니다.");
  if (config.technical.state !== "approved")
    reasons.push("기술 승인이 필요합니다.");
  if (config.quality.state !== "approved")
    reasons.push("품질 승인이 필요합니다.");
  if (config.state !== "approved") reasons.push("구성 승인이 필요합니다.");
  if (
    !offer ||
    offer.kind !== "offer" ||
    offer.configRevision !== config.revision ||
    offer.requestRevision !== c.request.revision
  )
    reasons.push("현재 요청·구성의 공급사 제안이 필요합니다.");
  if (offer && Date.parse(offer.validUntil) <= now)
    reasons.push("제안 유효 기간이 지났습니다.");
  if (
    !commitment ||
    commitment.status !== "confirmed" ||
    commitment.proposalId !== offer?.id
  )
    reasons.push("유효한 공급 확약 확인이 필요합니다.");
  if (
    (commitment &&
      Date.parse(commitment.availableAt) > Date.parse(project.targetDate)) ||
    (offer && Date.parse(offer.availableAt) > Date.parse(project.targetDate))
  )
    reasons.push("공급 가능일이 목표 기간 밖입니다.");
  const allocated = assigned(project, c.key);
  const available = Math.max(
    0,
    (commitment?.status === "confirmed" ? commitment.quantity : 0) -
      c.otherAllocation,
  );
  return {
    ready: !reasons.length,
    reasons,
    rule: rule.result,
    available,
    assigned: allocated,
    overallocated: Math.max(
      0,
      allocated + c.otherAllocation - (commitment?.quantity ?? 0),
    ),
    capacity: reasons.length ? 0 : Math.floor(available / 2),
  };
}
export function metrics(project: Project, now = Date.now()) {
  const all = Object.values(project.suppliers).map((c) =>
    readiness(project, c, now),
  );
  const coverage = Math.min(
    project.target,
    all.reduce((s, c) => s + c.capacity, 0),
  );
  const selected = Math.min(
    project.target,
    all.reduce((s, c) => s + Math.floor(c.assigned / 2), 0),
  );
  return {
    coverage,
    selected,
    shortage: project.target - coverage,
    unselected: project.target - selected,
    overallocated: all.reduce((s, c) => s + c.overallocated, 0),
  };
}
function newConfiguration(project: Project, c: Collaboration) {
  c.configurations.push({
    revision: currentConfig(c).revision + 1,
    requirementRevision: project.requirement.revision,
    bomRevision: project.bomRevision,
    state: "reviewing",
    technical: { state: "reviewing", evidence: "" },
    quality: { state: "reviewing", evidence: "" },
    ruleVersion: project.extension.version,
    policyRevision: project.extension.revision,
  });
}
function ensureCurrentOffer(c: Collaboration) {
  const offer = currentOffer(c);
  ensure(
    offer?.kind === "offer" &&
      offer.configRevision === currentConfig(c).revision &&
      offer.requestRevision === c.request.revision,
    "현재 요청·구성의 공급사 제안이 필요합니다.",
  );
}
function validateLine(project: Project, line: AwardLine, now: number) {
  const c = project.suppliers[line.supplier],
    status = readiness(project, c, now),
    proposal = currentOffer(c)!;
  ensure(status.ready, `${c.name}: ${status.reasons.join(" ")}`);
  ensure(
    line.quantity > 0 && line.quantity % 2 === 0,
    "서버당 동일 모듈 2개 단위로 선정합니다.",
  );
  ensure(
    line.quantity >= proposal.minQuantity && line.quantity <= proposal.quantity,
    "선정 수량이 제안의 최소·최대 수량 조건을 벗어납니다.",
  );
  ensure(
    line.proposalId === proposal.id &&
      line.configRevision === currentConfig(c).revision &&
      line.commitmentRevision === currentCommitment(c)!.revision,
    "선정안의 기준이 바뀌었습니다. 새 선정안을 작성하세요.",
    409,
  );
  ensure(
    line.quantity + status.assigned <= status.available,
    "선정 시점의 잔여 가용 물량이 부족합니다.",
    409,
  );
}
export function applyCommand(
  source: Project,
  actor: Actor,
  command: Command,
  now = Date.now(),
): Project {
  checkAccess(source, actor);
  ensure(
    actionRoles[command.action] && has(actor, ...actionRoles[command.action]),
    "이 행동의 권한이 없습니다.",
    403,
  );
  ensure(
    command.expectedVersion === versionFor(source, actor),
    "다른 참여자가 먼저 변경했습니다. 최신 내용을 확인하세요.",
    409,
  );
  const parsed = schemas[command.action].safeParse(command.payload);
  ensure(parsed.success, "입력 형식이나 필수 항목을 확인하세요.", 400);
  const data = parsed.data as Record<string, any>;
  const project = structuredClone(source),
    at = new Date(now).toISOString();
  const supplier = data.supplier as SupplierKey | undefined;
  const c = supplier ? project.suppliers[supplier] : undefined;
  if (actor.supplier)
    ensure(
      supplier === actor.supplier || data.channel === actor.supplier,
      "이 협의에 접근할 수 없습니다.",
      403,
    );
  let channel: SupplierKey | "internal" = supplier ?? "internal";
  switch (command.action) {
    case "request.issue":
      c!.request = {
        revision: c!.request.revision + 1,
        published: true,
        quantity: data.quantity,
        specification: `SP-PSU-01 v${project.requirement.revision}`,
        requirement: structuredClone(project.requirement),
      };
      break;
    case "proposal.submit":
    case "proposal.counter": {
      ensure(c!.request.published, "먼저 요청을 발행해야 합니다.");
      ensure(
        c!.request.requirement.revision ===
          currentConfig(c!).requirementRevision &&
          c!.publicConfiguration.revision === currentConfig(c!).revision,
        "요청의 개정 확인이 필요합니다. 구매 담당자에게 확인하세요.",
      );
      ensure(
        Date.parse(data.validUntil) > now,
        "제안 유효 기간은 현재 이후여야 합니다.",
      );
      ensure(
        data.minQuantity <= data.quantity,
        "최소 수량이 제안 수량보다 큽니다.",
      );
      const previous = currentOffer(c!);
      if (
        previous &&
        (previous.voltage !== data.voltage || previous.outputW !== data.outputW)
      )
        newConfiguration(project, c!);
      c!.proposals.push({
        id: randomUUID(),
        revision: c!.proposals.length + 1,
        requestRevision: c!.request.revision,
        kind: command.action === "proposal.submit" ? "offer" : "counter",
        author: actor.name,
        quantity: data.quantity,
        minQuantity: data.minQuantity,
        unitPriceCents: data.unitPriceCents,
        availableAt: data.availableAt,
        validUntil: data.validUntil,
        voltage: data.voltage,
        outputW: data.outputW,
        note: data.note,
        configRevision: currentConfig(c!).revision,
        createdAt: at,
      });
      break;
    }
    case "review.technical":
    case "review.quality": {
      const config = currentConfig(c!),
        review =
          command.action === "review.technical"
            ? config.technical
            : config.quality;
      if (data.decision === "approve") {
        ensureCurrentOffer(c!);
        ensure(
          evaluatePower(project, c!).result === "passed",
          "필수 전원 조건이 충족되지 않았습니다.",
        );
      }
      review.state = changeReview(
        review.state,
        { start: "START", approve: "APPROVE", reject: "REJECT" }[
          data.decision as "start" | "approve" | "reject"
        ],
      );
      review.evidence = data.evidence;
      review.actor = actor.name;
      review.at = at;
      break;
    }
    case "configuration.approve": {
      const config = currentConfig(c!);
      ensureCurrentOffer(c!);
      ensure(
        config.technical.state === "approved" &&
          config.quality.state === "approved" &&
          evaluatePower(project, c!).result === "passed",
        "기술·품질 승인과 전원 조건을 확인하세요.",
      );
      ensure(
        config.requirementRevision === project.requirement.revision &&
          config.bomRevision === project.bomRevision &&
          config.policyRevision === project.extension.revision,
        "기준 개정이 다릅니다. 재검토하세요.",
      );
      config.state = "approved";
      break;
    }
    case "commitment.submit": {
      const offer = currentOffer(c!);
      ensureCurrentOffer(c!);
      ensure(offer?.kind === "offer", "공급사 제안을 먼저 제출하세요.");
      ensure(
        Date.parse(data.availableAt) >= Date.parse(offer.availableAt),
        "제안의 공급 가능일보다 빠른 확약일을 사용할 수 없습니다.",
      );
      ensure(
        data.quantity <= offer.quantity,
        "확약 물량이 제안 물량을 초과합니다.",
      );
      c!.commitments.push({
        revision: c!.commitments.length + 1,
        status: "submitted",
        quantity: data.quantity,
        availableAt: data.availableAt,
        proposalId: offer.id,
        at,
      });
      break;
    }
    case "commitment.confirm": {
      const previous = currentCommitment(c!),
        offer = currentOffer(c!);
      ensure(
        previous?.status === "submitted" &&
          offer?.kind === "offer" &&
          previous.proposalId === offer.id &&
          Date.parse(offer.validUntil) > now,
        "확인 가능한 현재 제안의 확약 제출이 없습니다.",
      );
      c!.commitments.push({
        ...previous,
        revision: c!.commitments.length + 1,
        status: "confirmed",
        at,
        confirmedBy: actor.name,
      });
      break;
    }
    case "commitment.reduce": {
      const previous = currentCommitment(c!);
      ensure(
        previous && data.quantity < previous.quantity,
        "현재 확약보다 작은 물량을 입력하세요.",
      );
      c!.commitments.push({
        ...previous,
        revision: c!.commitments.length + 1,
        status: data.quantity === 0 ? "withdrawn" : previous.status,
        quantity: data.quantity,
        at,
      });
      project.messages.push({
        id: randomUUID(),
        channel: supplier!,
        author: actor.name,
        text: data.reason,
        at,
      });
      break;
    }
    case "allocation.other": {
      const committed = currentCommitment(c!);
      if (data.quantity > c!.otherAllocation)
        ensure(
          committed?.status === "confirmed" &&
            data.quantity + assigned(project, supplier!) <= committed.quantity,
          "공유 출처의 가용 물량을 초과할 수 없습니다.",
          409,
        );
      c!.otherAllocation = data.quantity;
      channel = "internal";
      break;
    }
    case "award.request": {
      const lines = (["A", "B"] as SupplierKey[])
        .filter((k) => data.quantities[k] > 0)
        .map((k) => {
          const source = project.suppliers[k];
          return {
            supplier: k,
            quantity: data.quantities[k],
            proposalId: currentOffer(source)?.id ?? "",
            configRevision: currentConfig(source).revision,
            commitmentRevision: currentCommitment(source)?.revision ?? 0,
            unitPriceCents: currentOffer(source)?.unitPriceCents ?? 0,
          };
        });
      ensure(lines.length, "선정할 수량을 입력하세요.");
      lines.forEach((line) => validateLine(project, line, now));
      ensure(
        metrics(project, now).selected +
          lines.reduce((sum, line) => sum + line.quantity / 2, 0) <=
          project.target,
        "전체 목표 수량을 초과합니다.",
      );
      project.awards.push({
        id: randomUUID(),
        state: "requested",
        lines,
        createdBy: actor.name,
        createdAt: at,
        published: [],
      });
      project.shortageOwner = data.owner;
      break;
    }
    case "award.approve": {
      const award = project.awards.find((a) => a.id === data.id);
      ensure(
        award?.state === "requested",
        "승인 요청 상태인 선정안을 찾을 수 없습니다.",
      );
      award.lines.forEach((line) => validateLine(project, line, now));
      ensure(
        metrics(project, now).selected +
          award.lines.reduce((sum, line) => sum + line.quantity / 2, 0) <=
          project.target,
        "전체 목표 수량을 초과합니다.",
      );
      award.state = "approved";
      award.approvedBy = actor.name;
      award.approvedAt = at;
      award.snapshot = {
        requirement: structuredClone(project.requirement),
        bomRevision: project.bomRevision,
        extension: structuredClone(project.extension),
        conditions: award.lines.map((l) => ({
          supplier: l.supplier,
          configuration: structuredClone(
            currentConfig(project.suppliers[l.supplier]),
          ),
          proposal: structuredClone(
            currentOffer(project.suppliers[l.supplier]),
          ),
          commitment: structuredClone(
            currentCommitment(project.suppliers[l.supplier]),
          ),
        })),
      };
      break;
    }
    case "award.reject": {
      const award = project.awards.find((a) => a.id === data.id);
      ensure(award?.state === "requested", "승인 요청 상태가 아닙니다.");
      award.state = "rejected";
      award.reason = data.reason;
      break;
    }
    case "award.publish": {
      const award = project.awards.find((a) => a.id === data.id);
      ensure(
        award?.state === "approved" &&
          award.lines.some((l) => l.supplier === supplier),
        "이 공급사에 게시할 승인 결과가 없습니다.",
      );
      ensure(
        !award.published.includes(supplier!),
        "이미 게시한 결과입니다.",
        409,
      );
      award.published.push(supplier!);
      break;
    }
    case "award.handoff": {
      const award = project.awards.find((a) => a.id === data.id);
      ensure(
        award?.state === "approved" &&
          award.lines.every((l) => award.published.includes(l.supplier)),
        "선정 승인과 공급사별 결과 게시를 먼저 완료하세요.",
      );
      award.handedOffAt = at;
      break;
    }
    case "design.revise":
      project.requirement = {
        ...project.requirement,
        revision: project.requirement.revision + 1,
        voltage: data.voltage,
        outputW: data.outputW,
      };
      Object.values(project.suppliers).forEach((collaboration) =>
        newConfiguration(project, collaboration),
      );
      break;
    case "extension.configure":
      project.extension = {
        ...project.extension,
        ...data,
        revision: project.extension.revision + 1,
      };
      Object.values(project.suppliers).forEach((collaboration) =>
        newConfiguration(project, collaboration),
      );
      break;
    case "membership.revoke":
      ensure(
        data.actorId !== actor.id,
        "이 화면에서 자신의 권한을 철회할 수 없습니다.",
      );
      project.revokedActors.push(data.actorId);
      break;
    case "message.send":
      channel = data.channel;
      project.messages.push({
        id: randomUUID(),
        channel,
        author: actor.name,
        text: data.text,
        at,
      });
      break;
  }
  const supplierVisible = ![
    "allocation.other",
    "award.request",
    "award.approve",
    "award.reject",
    "award.handoff",
    "extension.configure",
    "design.revise",
    "membership.revoke",
  ].includes(command.action);
  if (supplierVisible && channel !== "internal") {
    const collaboration = project.suppliers[channel];
    collaboration.revision++;
    if (
      command.action === "request.issue" ||
      ((["proposal.submit", "proposal.counter"].includes(command.action) ||
        currentConfig(collaboration).revision ===
          collaboration.publicConfiguration.revision) &&
        currentConfig(collaboration).requirementRevision ===
          collaboration.request.requirement.revision)
    )
      collaboration.publicConfiguration = structuredClone(
        currentConfig(collaboration),
      );
  }
  project.activities.push({
    id: randomUUID(),
    action: command.action,
    title: titles[command.action],
    actor: actor.name,
    channel: supplierVisible ? channel : "internal",
    at,
    reference: `REQ-PWR-01 v${project.requirement.revision} · BOM R${project.bomRevision}`,
  });
  project.version++;
  return project;
}

export function projectView(
  project: Project,
  actor: Actor,
  now = Date.now(),
): Workspace {
  checkAccess(project, actor);
  const commercial = has(actor, "buyer", "approver", "supplier"),
    internal = !actor.supplier;
  const suppliers = Object.values(project.suppliers)
    .filter((c) => internal || c.key === actor.supplier)
    .map((c) => {
      const config = structuredClone(
        internal ? currentConfig(c) : c.publicConfiguration,
      );
      if (!internal) {
        config.technical = { state: config.technical.state, evidence: "" };
        config.quality = { state: config.quality.state, evidence: "" };
        config.bomRevision = c.request.revision;
        config.policyRevision = 0;
        config.ruleVersion = "";
      }
      return {
        key: c.key,
        name: c.name,
        revision: c.revision,
        request: c.request,
        configuration: config,
        proposals: c.proposals.map((p) => {
          const { unitPriceCents, ...rest } = p;
          return commercial
            ? { ...rest, unitPriceCents }
            : { ...rest, note: "" };
        }),
        commitment: currentCommitment(c),
        ...(internal ? { readiness: readiness(project, c, now) } : {}),
        publishedAwards: project.awards
          .filter((a) => a.state === "approved" && a.published.includes(c.key))
          .map((a) => {
            const { supplier, unitPriceCents, ...line } = a.lines.find(
              (l) => l.supplier === c.key,
            )!;
            return {
              id: a.id,
              ...line,
              at: a.approvedAt!,
              ...(commercial ? { unitPriceCents } : {}),
            };
          }),
      };
    });
  return {
    id: project.id,
    name: internal
      ? project.name
      : `${suppliers[0]?.request.specification ?? "전원 모듈"} · 개별 협의`,
    tenant: actor.tenant,
    version: versionFor(project, actor),
    actor,
    targetDate: project.targetDate,
    requirement: internal
      ? project.requirement
      : suppliers[0].request.requirement,
    bomRevision: internal ? project.bomRevision : suppliers[0].request.revision,
    suppliers,
    ...(internal
      ? {
          target: project.target,
          bomCount: project.bomCount,
          metrics: metrics(project, now),
          shortageOwner: project.shortageOwner,
        }
      : {}),
    ...(has(actor, "buyer", "approver") ? { awards: project.awards } : {}),
    messages: project.messages.filter((m) =>
      internal ? commercial : m.channel === actor.supplier,
    ),
    activities: project.activities
      .filter((e) =>
        internal
          ? commercial ||
            ![
              "proposal.counter",
              "award.request",
              "award.approve",
              "award.reject",
            ].includes(e.action)
          : e.channel === actor.supplier,
      )
      .slice(-40)
      .map((e) =>
        internal ? e : { ...e, reference: suppliers[0].request.specification },
      ),
    ...(has(actor, "admin")
      ? { extension: project.extension, mappings: project.mappings }
      : {}),
    actions: Object.entries(actionRoles)
      .filter(([, roles]) => has(actor, ...roles))
      .map(([action]) => action),
  };
}
