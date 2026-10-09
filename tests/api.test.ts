import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "../src/server/main.js";
import { applyCommand } from "../src/server/domain.js";
import {
  defaultMappings,
  demoActors,
  seedBom,
  seedProject,
} from "../src/server/seed.js";
import type { Project, Workspace } from "../src/shared/model.js";
import { csvExport } from "../src/server/bom.js";
import { exportBackup, restoreBackup } from "../src/server/backup.js";
import { HttpAgent } from "@ag-ui/client";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import { navigationSchema } from "../src/shared/navigation.js";

function navigationInput(command: string, selectedSupplier = "B") {
  return {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content: command }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: { selectedSupplier },
  };
}
async function navigationEvents(command: string, who = "lead") {
  const response = await request("/navigation", who, navigationInput(command));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => EventSchema.parse(JSON.parse(line.slice(6))));
}

let server: Awaited<ReturnType<typeof bootstrap>>, base: string;
const admin = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
type Session = { cookie: string; csrf: string };
const sessions: Record<string, Session> = {};
async function start() {
  server = await bootstrap(0);
  base = `${await server.app.getUrl()}/api`;
}
async function request(path: string, who = "lead", body?: unknown) {
  const session = sessions[who];
  return fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: session?.cookie ?? "",
      "x-csrf-token": session?.csrf ?? "",
      origin: "http://127.0.0.1:5173",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function view(who = "lead"): Promise<Workspace> {
  const response = await request("/workspace", who);
  expect(response.status).toBe(200);
  return response.json();
}
async function command(
  action: string,
  payload: Record<string, unknown>,
  who = "lead",
  requestId = randomUUID(),
  expectedVersion?: number,
) {
  const version = expectedVersion ?? (await view(who)).version;
  return request("/commands", who, {
    action,
    payload,
    expectedVersion: version,
    requestId,
  });
}
async function saveState(p: Project) {
  await admin.query("UPDATE workspaces SET state=$1 WHERE tenant=$2", [
    p,
    p.tenant,
  ]);
}
function readyState() {
  let p = seedProject();
  for (const action of [
    "review.technical",
    "review.quality",
    "configuration.approve",
    "commitment.confirm",
  ])
    p = applyCommand(p, demoActors[0], {
      action,
      expectedVersion: p.version,
      requestId: randomUUID(),
      payload: action.startsWith("review")
        ? { supplier: "B", decision: "approve", evidence: "TEST-01" }
        : { supplier: "B" },
    });
  return p;
}
beforeAll(async () => {
  await start();
  for (const [who, email] of Object.entries({
    lead: "lead@demo.local",
    a: "a@supplier.demo",
    b: "b@supplier.demo",
    design: "design@demo.local",
    reuse: "reuse@demo.local",
  })) {
    const response = await request("/login", who, {
      email,
      password: "D2S-demo-2026!",
    });
    expect(response.status).toBe(201);
    sessions[who] = {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      csrf: (await response.json()).csrf,
    };
  }
});
beforeEach(async () => {
  await admin.query("TRUNCATE decisions, requests, files, boms");
  for (const tenant of ["buyer-demo", "buyer-reuse"]) {
    const p = seedProject(tenant);
    await saveState(p);
    await admin.query(
      "INSERT INTO boms(tenant,project_id,revision,mapping,rows) VALUES($1,$2,1,$3,$4)",
      [tenant, p.id, p.mappings[0], JSON.stringify(seedBom())],
    );
  }
});
afterAll(async () => {
  await server?.app.close();
  await server?.store.close();
  await admin.end();
});

describe("PostgreSQL, API and access boundaries", () => {
  it("AG-UI navigates with the real SDK and leaves all business state unchanged", async () => {
    const before = await view();
    const events: BaseEvent[] = [];
    let feedback = "";
    const agent = new HttpAgent({
      url: `${base}/navigation`,
      threadId: randomUUID(),
      headers: {
        cookie: sessions.lead.cookie,
        "x-csrf-token": sessions.lead.csrf,
        origin: "http://127.0.0.1:5173",
      },
      initialMessages: [
        { id: randomUUID(), role: "user", content: "공급사 B 검토 열어줘" },
      ],
      initialState: {
        metrics: { selected: 500 },
        supplier: "A",
        approved: true,
      },
    });
    await agent.runAgent(
      { runId: randomUUID(), forwardedProps: { selectedSupplier: "A" } },
      {
        onEvent: ({ event }) => {
          events.push(EventSchema.parse(event));
        },
        onTextMessageContentEvent: ({ event }) => {
          feedback += event.delta;
        },
      },
    );
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STEP_STARTED,
      EventType.STEP_FINISHED,
      EventType.STATE_SNAPSHOT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(navigationSchema.parse(agent.state)).toEqual({
      actorId: before.actor.id,
      sourceVersion: before.version,
      supplier: "B",
      tab: "map",
      panel: "review",
    });
    expect(agent.messages.at(-1)?.content).toBe(
      "공급사 B의 관계도와 검토 패널을 열었습니다.",
    );
    expect(feedback).toBe("공급사 B의 관계도와 검토 패널을 열었습니다.");
    expect(await view()).toEqual(before);
    expect(
      (await admin.query("SELECT count(*) FROM decisions")).rows[0].count,
    ).toBe("0");
  });
  it("AG-UI returns only the supplier's own navigation target and hides other targets", async () => {
    const own = await view("b");
    const allowed = await navigationEvents("현재 대안 협의 열어줘", "b");
    expect(
      allowed.find((event) => event.type === EventType.STATE_SNAPSHOT),
    ).toMatchObject({
      snapshot: {
        actorId: own.actor.id,
        sourceVersion: own.version,
        supplier: "B",
        panel: "discussion",
      },
    });
    const foreign = await navigationEvents("공급사 A 검토 열어줘", "b");
    const missing = await navigationEvents("공급사 C 검토 열어줘", "b");
    expect(foreign.at(-1)).toEqual(missing.at(-1));
    expect(foreign.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      code: "404",
      message: "열 수 있는 공급 대안을 찾지 못했습니다.",
    });
    expect(
      foreign.some((event) => event.type === EventType.STATE_SNAPSHOT),
    ).toBe(false);
    expect(JSON.stringify(foreign)).not.toMatch(
      /공급사 A|PSU-A|unitPriceCents|500/,
    );
    expect(await view("b")).toEqual(own);
  });
  it("AG-UI rejects business commands, restricted panels and forged tool/context input", async () => {
    const before = await view();
    expect((await navigationEvents("선정 승인해줘")).at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      code: "422",
    });
    for (const command of ["공급사 B 자료 열어줘", "공급사 B 협의 열어줘"])
      expect((await navigationEvents(command, "design")).at(-1)).toMatchObject({
        type: EventType.RUN_ERROR,
        code: "403",
      });
    expect((await navigationEvents("PSU-B 자료 보기")).at(-1)?.type).toBe(
      EventType.RUN_FINISHED,
    );
    expect((await request("/navigation", "lead", {})).status).toBe(400);
    for (const extra of [
      {
        tools: [
          { name: "award.approve", description: "approve", parameters: {} },
        ],
      },
      { context: [{ description: "scope", value: "all tenants" }] },
      { forwardedProps: { selectedSupplier: "B", tenant: "buyer-reuse" } },
    ])
      expect(
        (
          await request("/navigation", "lead", {
            ...navigationInput("공급사 B 검토"),
            ...extra,
          })
        ).status,
      ).toBe(400);
    expect(await view()).toEqual(before);
  });
  it("AG-UI checks authentication, CSRF and current membership on every request", async () => {
    expect(
      (
        await request(
          "/navigation",
          "missing",
          navigationInput("공급사 B 검토"),
        )
      ).status,
    ).toBe(401);
    const noCsrf = await fetch(`${base}/navigation`, {
      method: "POST",
      headers: {
        cookie: sessions.lead.cookie,
        origin: "http://127.0.0.1:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(navigationInput("공급사 B 검토")),
    });
    expect(noCsrf.status).toBe(403);
    const p = seedProject();
    p.revokedActors.push(
      demoActors.find((actor) => actor.supplier === "B")!.id,
    );
    await saveState(p);
    expect(
      (await request("/navigation", "b", navigationInput("공급사 B 검토")))
        .status,
    ).toBe(403);
  });
  it("returns deterministic facts without a model endpoint or capability field", async () => {
    const p = await view();
    expect(p).not.toHaveProperty("aiAvailable");
    const facts = await request("/facts");
    expect(facts.status).toBe(200);
    expect((await facts.json()).metrics).toMatchObject({
      coverage: 300,
      selected: 0,
    });
    expect((await request("/ai/summary", "lead", {})).status).toBe(404);
  });
  it("enforces cookie sessions, CSRF and role checks on the server", async () => {
    expect((await request("/workspace", "missing")).status).toBe(401);
    const noCsrf = await fetch(`${base}/commands`, {
      method: "POST",
      headers: {
        cookie: sessions.lead.cookie,
        origin: "http://127.0.0.1:5173",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(noCsrf.status).toBe(403);
    expect(
      (
        await command(
          "award.request",
          { quantities: { A: 600, B: 0 }, owner: "구매" },
          "b",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await command(
          "commitment.reduce",
          { supplier: "A", quantity: 100, reason: "invalid" },
          "b",
        )
      ).status,
    ).toBe(403);
  });
  it("C07 serializes a selection and competing allocation on the same supply", async () => {
    await saveState(readyState());
    const requested = await command("award.request", {
      quantities: { A: 0, B: 400 },
      owner: "구매",
    });
    expect(requested.status).toBe(201);
    const p = await view(),
      id = p.awards![0].id;
    const responses = await Promise.all([
      command("award.approve", { id }, "lead", randomUUID(), p.version),
      command(
        "allocation.other",
        { supplier: "B", quantity: 100 },
        "lead",
        randomUUID(),
        p.version,
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const stored = await server.store.read(demoActors[0]);
    const allocated = stored.awards
      .filter((a) => a.state === "approved")
      .flatMap((a) => a.lines)
      .reduce((s, l) => s + (l.supplier === "B" ? l.quantity : 0), 0);
    expect(allocated + stored.suppliers.B.otherAllocation).toBeLessThanOrEqual(
      400,
    );
    const retry = allocated
      ? await command("allocation.other", { supplier: "B", quantity: 100 })
      : await command("award.approve", { id });
    expect(retry.status).toBe(409);
  });
  it("C11 commits an idempotent request once and retains it across an API restart", async () => {
    const id = randomUUID(),
      version = (await view()).version,
      payload = { channel: "B", text: "중복 방지 검증" };
    const responses = await Promise.all([
      command("message.send", payload, "lead", id, version),
      command("message.send", payload, "lead", id, version),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    await server.app.close();
    await server.store.close();
    await start();
    expect(
      (await command("message.send", payload, "lead", id, version)).status,
    ).toBe(201);
    expect(
      (await view()).messages.filter((m) => m.text === payload.text),
    ).toHaveLength(1);
    expect(
      (await admin.query("SELECT count(*)::int AS n FROM decisions")).rows[0].n,
    ).toBe(1);
    expect(
      (
        await command(
          "message.send",
          { ...payload, text: "다른 내용" },
          "lead",
          id,
          version,
        )
      ).status,
    ).toBe(409);
  });
  it("RLS isolates tenants and the application cannot rewrite audit history", async () => {
    expect(
      (await server.store.pool.query("SELECT * FROM workspaces")).rowCount,
    ).toBe(0);
    const rows = await server.store.transaction("buyer-demo", (c) =>
      c.query("SELECT tenant FROM workspaces"),
    );
    expect(rows.rows).toEqual([{ tenant: "buyer-demo" }]);
    await expect(
      server.store.transaction("buyer-demo", (c) =>
        c.query(
          "UPDATE workspaces SET tenant='buyer-reuse' WHERE tenant='buyer-demo'",
        ),
      ),
    ).rejects.toThrow();
    await expect(
      server.store.transaction("buyer-demo", (c) =>
        c.query("DELETE FROM decisions"),
      ),
    ).rejects.toThrow(/permission/);
    expect((await view("reuse")).requirement.voltage).toBe(208);
    expect((await view("lead")).requirement.voltage).toBe(230);
  });
  it("C12 scopes attachments, search, facts and handoff to the authorized actor", async () => {
    const file = {
      requestId: randomUUID(),
      channel: "A",
      name: "PRIVATE-A.txt",
      mime: "text/plain",
      content: Buffer.from("PRIVATE-A-PRICE").toString("base64"),
    };
    const uploaded = await request("/files", "lead", file);
    expect(uploaded.status).toBe(201);
    const { id } = await uploaded.json();
    expect((await request("/files", "lead", file)).status).toBe(201);
    expect(
      (await admin.query("SELECT count(*)::int AS n FROM files")).rows[0].n,
    ).toBe(1);
    expect(await (await request(`/files/${id}`, "a")).text()).toBe(
      "PRIVATE-A-PRICE",
    );
    expect((await request(`/files/${id}`, "b")).status).toBe(404);
    expect((await request(`/files/${id}`, "reuse")).status).toBe(404);
    expect((await request(`/files/${id}`, "design")).status).toBe(403);
    expect((await request("/files?channel=A", "b")).status).toBe(404);
    expect((await request("/history", "b")).status).toBe(403);
    expect((await request("/handoff/fake", "b")).status).toBe(403);
    for (const path of [
      "/workspace",
      "/facts",
      "/bom?q=PSU-A",
      "/bom?view=hierarchy&q=PSU-A&revision=1",
    ]) {
      const text = await (await request(path, "b")).text();
      expect(text).not.toMatch(
        /PRIVATE-A|PSU-A|supplier-A|otherAllocation|unitPriceCents":18900/,
      );
    }
  });
  it("publishes configured BOM columns/custom attributes, masks omitted supplier fields and preserves old versions", async () => {
    const mapping = structuredClone(defaultMappings[0]);
    mapping.columns["attr.certification"] = "인증";
    mapping.visibleColumns = ["name", "attr.certification", "part"];
    mapping.sharedFields = ["part", "quantity"];
    const fields = Object.keys(mapping.columns);
    const input = {
      format: "csv",
      mapping,
      content: csvExport([
        fields.map((f) => mapping.columns[f]),
        ...seedBom().map((row) =>
          fields.map((f) =>
            f === "attr.certification"
              ? "CERT-01"
              : String(row[f as keyof typeof row]),
          ),
        ),
      ]),
    };
    expect((await request("/bom/preview", "b", input)).status).toBe(403);
    expect((await request("/bom/preview", "lead", input)).status).toBe(201);
    const body = {
      ...input,
      expectedVersion: (await view()).version,
      requestId: randomUUID(),
    };
    expect((await request("/bom/publish", "lead", body)).status).toBe(201);
    expect((await request("/bom/publish", "lead", body)).status).toBe(201);
    const bom = await (await request("/bom")).json();
    expect(bom.columns).toEqual(mapping.visibleColumns);
    expect(bom.rows[0].attributes.certification).toBe("CERT-01");
    expect(bom.revision).toBe(2);
    const shared = await (await request("/bom", "b")).json();
    expect(Object.keys(shared.rows[0]).sort()).toEqual([
      "occurrence",
      "part",
      "quantity",
    ]);
    const hierarchy = await (await request("/bom?view=hierarchy")).json();
    expect(hierarchy.scope).toBe("internal");
    expect(hierarchy.rows).toHaveLength(seedBom().length);
    expect(
      hierarchy.rows.find(
        (r: { occurrence: string }) => r.occurrence === "PSU-CTRL",
      ).parent,
    ).toBe("PSU-1");
    const restricted = await (await request("/bom?view=hierarchy", "b")).json();
    expect(restricted.scope).toBe("published");
    expect(restricted.rows).toEqual(shared.rows);
    expect(JSON.stringify(restricted)).not.toMatch(
      /parent|PSU-CTRL|PWR-CAGE|category/,
    );
    expect(
      (await (await request("/bom?revision=1")).json()).rows[0],
    ).not.toHaveProperty("attributes.certification");
    expect((await view()).metrics!.coverage).toBe(0);
    const before = await view("b");
    await command("message.send", { channel: "B", text: "재검토 예정" });
    expect((await view("b")).suppliers[0].configuration).toEqual(
      before.suppliers[0].configuration,
    );
  });
  it("blocks L6 BOM publication without changing the current revision", async () => {
    const mapping = defaultMappings[0];
    const fields = Object.keys(mapping.columns);
    const deep = Array.from({ length: 6 }, (_, i) => ({
      ...seedBom()[0],
      occurrence: `L${i + 1}`,
      parent: i ? `L${i}` : "",
    }));
    const input = {
      format: "csv",
      mapping,
      content: csvExport([
        fields.map((f) => mapping.columns[f]),
        ...deep.map((row) =>
          fields.map((f) => String(row[f as keyof typeof row])),
        ),
      ]),
    };
    const preview = await (await request("/bom/preview", "lead", input)).json();
    expect(
      preview.errors.some((e: { message: string }) => e.message.includes("L6")),
    ).toBe(true);
    const before = await view();
    expect(
      (
        await request("/bom/publish", "lead", {
          ...input,
          expectedVersion: before.version,
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(422);
    expect((await view()).bomRevision).toBe(before.bomRevision);
  });
  it("restores a consistent business backup and invalidates sessions, without overwriting live records", async () => {
    await saveState(readyState());
    await command("award.request", {
      quantities: { A: 600, B: 400 },
      owner: "복원 검증",
    });
    const p = await view();
    await command("award.approve", { id: p.awards![0].id });
    await request("/files", "lead", {
      requestId: randomUUID(),
      channel: "A",
      name: "restore.txt",
      mime: "text/plain",
      content: Buffer.from("RESTORE-EVIDENCE").toString("base64"),
    });
    const expected = await view(),
      backup = JSON.parse(JSON.stringify(await exportBackup(admin)));
    await expect(restoreBackup(admin, backup)).rejects.toThrow(
      /빈 데이터베이스/,
    );
    // This is the disposable test database created by scripts/test.mjs.
    expect(new URL(process.env.MIGRATION_DATABASE_URL!).pathname).toMatch(
      /^\/caidentia_test_/,
    );
    await admin.query(
      "TRUNCATE sessions, actors, workspaces, decisions, requests, boms, files",
    );
    await restoreBackup(admin, backup);
    expect((await request("/workspace")).status).toBe(401);
    const restored = await server.store.view(demoActors[0]);
    expect(restored.metrics).toEqual(expected.metrics);
    expect(restored.awards).toEqual(expected.awards);
    expect(
      (
        await admin.query("SELECT content FROM files")
      ).rows[0].content.toString(),
    ).toBe("RESTORE-EVIDENCE");
    for (const [who, email] of Object.entries({
      lead: "lead@demo.local",
      a: "a@supplier.demo",
      b: "b@supplier.demo",
      design: "design@demo.local",
      reuse: "reuse@demo.local",
    })) {
      const response = await request("/login", who, {
        email,
        password: "D2S-demo-2026!",
      });
      sessions[who] = {
        cookie: response.headers.get("set-cookie")!.split(";")[0],
        csrf: (await response.json()).csrf,
      };
    }
  });
  it("records a local baseline with 10,000 BOM rows, 100 sessions/SSE streams and 10 changes per second", async () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      ...seedBom()[0],
      occurrence: `ROW-${i}`,
      part: `PART-${i}`,
      parent: i ? `ROW-${Math.floor((i - 1) / 12)}` : "",
    }));
    await admin.query("UPDATE boms SET rows=$1 WHERE tenant=$2", [
      JSON.stringify(rows),
      "buyer-demo",
    ]);
    const state = seedProject();
    state.bomCount = rows.length;
    await saveState(state);
    const hierarchy = await (await request("/bom?view=hierarchy")).json();
    expect(hierarchy.rows).toHaveLength(10000);
    const users = await Promise.all(
      Array.from({ length: 100 }, () =>
        server.store.login("lead@demo.local", "D2S-demo-2026!"),
      ),
    );
    const streams = await Promise.all(
      users.map((user) =>
        fetch(`${base}/events`, {
          headers: { cookie: `caidentia_session=${user.token}` },
        }),
      ),
    );
    const started = performance.now();
    try {
      const durations = await Promise.all(
        users.map(async (user, i) => {
          const at = performance.now(),
            response = await fetch(`${base}${i % 2 ? "/bom" : "/workspace"}`, {
              headers: { cookie: `caidentia_session=${user.token}` },
            });
          expect(response.status).toBe(200);
          await response.json();
          return performance.now() - at;
        }),
      );
      const writes: number[] = [];
      for (let i = 0; i < 20; i++) {
        const at = performance.now();
        expect(
          (
            await command("message.send", {
              channel: "B",
              text: `부하 검증 ${i}`,
            })
          ).status,
        ).toBe(201);
        writes.push(performance.now() - at);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 100 - (performance.now() - at))),
        );
      }
      const p95 = (values: number[]) =>
        Math.round(
          [...values].sort((a, b) => a - b)[
            Math.ceil(values.length * 0.95) - 1
          ],
        );
      mkdirSync(".data/validation", { recursive: true });
      writeFileSync(
        ".data/validation/performance.json",
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            host: {
              platform: platform(),
              arch: arch(),
              cpu: cpus()[0].model,
              node: process.version,
            },
            fixture: {
              bomRows: 10000,
              sessions: 100,
              sseStreams: 100,
              parallelReads: 100,
              mutations: 20,
              mutationsPerSecond: 10,
              databasePool: 12,
            },
            result: {
              readP95Ms: p95(durations),
              readMaxMs: Math.round(Math.max(...durations)),
              writeWithRefreshP95Ms: p95(writes),
              elapsedMs: Math.round(performance.now() - started),
            },
            excludes: [
              "30,000 relationship traversal",
              "200-node/400-edge browser rendering",
              "customer network",
              "SSE latency percentiles",
              "human usability",
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      await Promise.all(streams.map((stream) => stream.body!.cancel()));
    }
  });
  it("C12 SSE sends only visible changes and closes after permission revocation", async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/events`, {
      headers: { cookie: sessions.b.cookie },
      signal: controller.signal,
    });
    const reader = response.body!.getReader(),
      chunks: string[] = [];
    const consume = (async () => {
      try {
        while (true) {
          const value = await reader.read();
          if (value.done) break;
          chunks.push(new TextDecoder().decode(value.value));
        }
      } catch {}
    })();
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    try {
      await wait(150);
      expect(chunks.join("")).toContain("revision");
      const initial = chunks.join("");
      expect(
        (
          await command("message.send", {
            channel: "A",
            text: "PRIVATE-A-EVENT",
          })
        ).status,
      ).toBe(201);
      await wait(1250);
      expect(chunks.join("")).toBe(initial);
      expect(
        (await command("message.send", { channel: "B", text: "공개된 변경" }))
          .status,
      ).toBe(201);
      await wait(1250);
      expect(chunks.join("").length).toBeGreaterThan(initial.length);
      expect(chunks.join("")).not.toContain("PRIVATE-A-EVENT");
      expect(
        (await command("membership.revoke", { actorId: "supplier-b" })).status,
      ).toBe(201);
      await wait(1250);
      expect(chunks.join("")).toContain("event: revoked");
      expect((await request("/workspace", "b")).status).toBe(403);
    } finally {
      controller.abort();
      await consume;
    }
  });
});
