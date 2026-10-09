import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  currentConfig,
  metrics,
  projectView,
  readiness,
  versionFor,
} from "../src/server/domain.js";
import { demoActors, seedProject } from "../src/server/seed.js";
import type { Actor, Project } from "../src/shared/model.js";

const now = Date.parse("2026-10-08T00:00:00Z");
const lead = demoActors[0],
  a = demoActors.find((a) => a.supplier === "A")!,
  b = demoActors.find((a) => a.supplier === "B")!;
const run = (
  p: Project,
  action: string,
  payload: Record<string, unknown>,
  actor: Actor = lead,
  time = now,
) =>
  applyCommand(
    p,
    actor,
    {
      action,
      payload,
      expectedVersion: versionFor(p, actor),
      requestId: randomUUID(),
    },
    time,
  );
function reviewed() {
  let p = seedProject("buyer-demo", now);
  for (const action of ["review.technical", "review.quality"])
    p = run(p, action, {
      supplier: "B",
      decision: "approve",
      evidence: "모의 시험 TEST-01 통과",
    });
  return run(p, "configuration.approve", { supplier: "B" });
}
function ready() {
  return run(reviewed(), "commitment.confirm", { supplier: "B" });
}
function awarded() {
  let p = run(ready(), "allocation.other", { supplier: "B", quantity: 100 });
  p = run(p, "award.request", {
    quantities: { A: 600, B: 300 },
    owner: "잔여 조달 담당자",
  });
  return run(p, "award.approve", { id: p.awards[0].id });
}
describe("D2S state and allocation acceptance", () => {
  it("C01 keeps published RFQ separate from unapproved configuration and internal revisions", () => {
    const initial = seedProject("buyer-demo", now);
    let p = run(initial, "design.revise", {
      voltage: 208,
      outputW: 1600,
      reason: "새 요구 전압",
    });
    expect(projectView(p, b, now)).toEqual(projectView(initial, b, now));
    p = run(p, "request.issue", { supplier: "B", quantity: 400 });
    expect(projectView(p, b, now).requirement.voltage).toBe(208);
    expect(currentConfig(p.suppliers.B).state).toBe("reviewing");
    expect(metrics(p, now).selected).toBe(0);
  });
  it("C02–C06 follows 300 → 300 → 500 → 450, selection remains explicit", () => {
    let p = seedProject("buyer-demo", now);
    expect(metrics(p, now).coverage).toBe(300);
    p = run(p, "review.technical", {
      supplier: "B",
      decision: "approve",
      evidence: "TECH-B",
    });
    expect(metrics(p, now).coverage).toBe(300);
    expect(() => run(p, "configuration.approve", { supplier: "B" })).toThrow();
    p = reviewed();
    expect(metrics(p, now)).toMatchObject({ coverage: 300, selected: 0 });
    p = ready();
    expect(metrics(p, now)).toMatchObject({
      coverage: 500,
      selected: 0,
      shortage: 0,
    });
    p = awarded();
    expect(metrics(p, now)).toMatchObject({
      coverage: 450,
      selected: 450,
      shortage: 50,
      unselected: 50,
    });
    expect(p.shortageOwner).toBe("잔여 조달 담당자");
  });
  it("C05 never mixes odd PSU quantities across suppliers", () => {
    const p = ready();
    p.suppliers.A.commitments.at(-1)!.quantity = 601;
    p.suppliers.B.commitments.at(-1)!.quantity = 399;
    expect(metrics(p, now).coverage).toBe(499);
    expect(() =>
      run(p, "award.request", {
        quantities: { A: 601, B: 398 },
        owner: "구매",
      }),
    ).toThrow(/2개/);
  });
  it("C08 preserves the approved snapshot after supply drops and blocks more allocation", () => {
    const p = awarded(),
      before = structuredClone(p.awards[0]);
    const reduced = run(
      p,
      "commitment.reduce",
      { supplier: "B", quantity: 200, reason: "생산 차질" },
      b,
    );
    expect(reduced.awards[0]).toEqual(before);
    expect(metrics(reduced, now)).toMatchObject({
      coverage: 350,
      selected: 450,
      shortage: 150,
      overallocated: 200,
    });
    expect(() =>
      run(reduced, "allocation.other", { supplier: "B", quantity: 102 }),
    ).toThrow();
    expect(() =>
      run(reduced, "award.request", {
        quantities: { A: 0, B: 2 },
        owner: "구매",
      }),
    ).toThrow();
  });
  it("C09 retains old approvals but a changed technical proposal requires new reviews", () => {
    let p = run(seedProject("buyer-demo", now), "review.technical", {
      supplier: "B",
      decision: "approve",
      evidence: "old tech",
    });
    const offer = p.suppliers.B.proposals.at(-1)!;
    p = run(
      p,
      "proposal.submit",
      {
        supplier: "B",
        quantity: 400,
        minQuantity: 2,
        unitPriceCents: 19600,
        availableAt: offer.availableAt,
        validUntil: offer.validUntil,
        voltage: 230,
        outputW: 1700,
        note: "출력 변경",
      },
      b,
    );
    expect(p.suppliers.B.configurations[0].technical.state).toBe("approved");
    expect(currentConfig(p.suppliers.B).technical.state).toBe("reviewing");
    expect(currentConfig(p.suppliers.B).revision).toBe(2);
    expect(currentConfig(p.suppliers.A).state).toBe("approved");
  });
  it("C10 rechecks expiry when approving, even without an expiry background task", () => {
    let p = ready();
    p = run(p, "award.request", {
      quantities: { A: 600, B: 400 },
      owner: "구매",
    });
    expect(() =>
      run(
        p,
        "award.approve",
        { id: p.awards[0].id },
        lead,
        now + 31 * 86400000,
      ),
    ).toThrow(/유효 기간/);
    expect(p.awards[0].state).toBe("requested");
  });
  it("rejects stale versions, cross-role approval and wrong supplier commands", () => {
    const p = ready();
    expect(() =>
      applyCommand(
        p,
        lead,
        {
          action: "award.request",
          expectedVersion: 1,
          requestId: randomUUID(),
          payload: { quantities: { A: 600, B: 400 }, owner: "구매" },
        },
        now,
      ),
    ).toThrow(/먼저 변경/);
    expect(() => run(p, "award.approve", { id: "missing" }, b)).toThrow(/권한/);
    expect(() =>
      run(
        p,
        "commitment.reduce",
        { supplier: "A", quantity: 100, reason: "invalid" },
        b,
      ),
    ).toThrow(/접근/);
  });
  it("excludes late deliveries and unverified Extension output", () => {
    const p = ready();
    p.suppliers.B.proposals.at(-1)!.availableAt = new Date(
      now + 61 * 86400000,
    ).toISOString();
    expect(metrics(p, now).coverage).toBe(300);
    const disabled = run(ready(), "extension.configure", {
      version: "1.1.0",
      enabled: false,
      minOutputW: 1600,
    });
    expect(readiness(disabled, disabled.suppliers.A, now)).toMatchObject({
      ready: false,
      rule: "unknown",
    });
    expect(metrics(disabled, now).coverage).toBe(0);
    expect(() =>
      run(disabled, "review.technical", {
        supplier: "A",
        decision: "approve",
        evidence: "stale",
      }),
    ).toThrow();
  });
  it("C12/C13 supplier projection does not change for private work, reveals only a separately published award", () => {
    const p = ready(),
      before = projectView(p, b, now);
    let q = run(p, "allocation.other", { supplier: "B", quantity: 100 });
    q = run(q, "award.request", {
      quantities: { A: 600, B: 300 },
      owner: "PRIVATE_OWNER",
    });
    q = run(q, "award.approve", { id: q.awards[0].id });
    expect(projectView(q, b, now)).toEqual(before);
    const supplierJson = JSON.stringify(projectView(q, b, now));
    for (const secret of [
      "supplier-A",
      "PRIVATE_OWNER",
      'unitPriceCents":18900',
      "TECH-A-01",
      "otherAllocation",
      "shortage",
      "bomCount",
      "aiAvailable",
    ])
      expect(supplierJson).not.toContain(secret);
    q = run(q, "award.publish", { id: q.awards[0].id, supplier: "B" });
    expect(
      projectView(q, b, now).suppliers[0].publishedAwards[0].quantity,
    ).toBe(300);
    expect(projectView(q, a, now).suppliers[0].publishedAwards).toHaveLength(0);
  });
  it("revocation, tenant isolation and commercial-text restrictions are server enforced", () => {
    let p = ready();
    p = run(p, "message.send", { channel: "B", text: "PRIVATE_PRICE" });
    const design = demoActors.find((a) => a.id === "designer")!;
    const view = projectView(p, design, now);
    expect(view.messages).toEqual([]);
    expect(
      view.suppliers.every((c) =>
        c.proposals.every(
          (offer) => offer.unitPriceCents === undefined && offer.note === "",
        ),
      ),
    ).toBe(true);
    expect(() => projectView(p, demoActors.at(-1)!, now)).toThrow(/찾을 수/);
    p = run(p, "membership.revoke", { actorId: b.id });
    expect(() => projectView(p, b, now)).toThrow(/권한/);
  });
  it("an internal BOM revision cannot leak through an unrelated supplier message", () => {
    const p = ready(),
      before = projectView(p, b, now);
    p.bomRevision++;
    p.suppliers.B.configurations.push({
      ...structuredClone(currentConfig(p.suppliers.B)),
      revision: 2,
      bomRevision: 2,
      state: "reviewing",
    });
    const q = run(
      p,
      "message.send",
      { channel: "B", text: "확인했습니다." },
      b,
    );
    expect(projectView(q, b, now).suppliers[0].configuration).toEqual(
      before.suppliers[0].configuration,
    );
  });
});
