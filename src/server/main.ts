import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request, Response, NextFunction } from "express";
import { json, static as serveStatic } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { navigationEvents, readNavigationInput } from "./navigation.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Store, digest } from "./store.js";
import {
  DomainError,
  checkAccess,
  ensure,
  has,
  projectView,
  versionFor,
} from "./domain.js";
import { csvExport, mapBom, mappingSchema, parseInput } from "./bom.js";
import { defaultMappings, seedBom } from "./seed.js";
import type {
  Actor,
  BomMapping,
  BomRow,
  Command,
  Project,
} from "../shared/model.js";

interface AuthRequest extends Request {
  actor: Actor;
  csrf: string;
}
const inputSchema = z.object({
  content: z.string().max(2800000),
  format: z.enum(["csv", "xlsx"]),
  mapping: mappingSchema,
});
const commandSchema = z
  .object({
    action: z.string().max(80),
    expectedVersion: z.number().int().min(1),
    requestId: z.uuid(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
const loginAttempts = new Map<string, { attempts: number; until: number }>();
@Controller("api")
class ApiController {
  constructor(@Inject(Store) private readonly store: Store) {}
  @Get("health") health() {
    return {
      status: "ok",
      name: "caidentia-d2s",
      mode: "synthetic-validation",
    };
  }
  @Post("login") async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const credentials = z
      .object({
        email: z.email().max(120),
        password: z.string().min(1).max(200),
      })
      .strict()
      .parse(body);
    const address = req.ip ?? "local",
      now = Date.now(),
      attempt = loginAttempts.get(address);
    ensure(
      !attempt || attempt.until < now || attempt.attempts < 20,
      "로그인 시도가 많습니다. 잠시 후 다시 시도하세요.",
      429,
    );
    loginAttempts.set(address, {
      attempts: attempt && attempt.until > now ? attempt.attempts + 1 : 1,
      until: now + 60000,
    });
    if (loginAttempts.size > 1000)
      for (const [key, value] of loginAttempts)
        if (value.until < now) loginAttempts.delete(key);
    const session = await this.store.login(
      credentials.email,
      credentials.password,
    );
    loginAttempts.delete(address);
    response.cookie("caidentia_session", session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 8 * 3600000,
      path: "/",
    });
    return { actor: session.actor, csrf: session.csrf };
  }
  @Post("logout") async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.store.pool.query("DELETE FROM sessions WHERE token=$1", [
      digest(req.cookies.caidentia_session),
    ]);
    response.clearCookie("caidentia_session", { path: "/" });
    return { ok: true };
  }
  @Get("me") me(@Req() req: AuthRequest) {
    return { actor: req.actor, csrf: req.csrf };
  }
  @Get("workspace") workspace(@Req() req: AuthRequest) {
    return this.store.view(req.actor);
  }
  @Post("navigation") async navigate(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res() response: Response,
  ) {
    const input = readNavigationInput(body),
      encoder = new EventEncoder({ accept: "text/event-stream" });
    response.status(200);
    response.setHeader("Content-Type", encoder.getContentType());
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    response.write(
      encoder.encode({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      }),
    );
    response.write(
      encoder.encode({
        type: EventType.STEP_STARTED,
        stepName: "대상과 공개 범위 확인",
      }),
    );
    try {
      const { actor } = await this.store.session(req.cookies.caidentia_session);
      const view = await this.store.view(actor);
      const events = navigationEvents(input, view);
      if (!response.destroyed)
        for (const event of events) response.write(encoder.encode(event));
    } catch (error) {
      if (!response.destroyed)
        response.write(
          encoder.encode({
            type: EventType.RUN_ERROR,
            message:
              error instanceof DomainError
                ? error.message
                : "탐색을 완료하지 못했습니다. 다시 시도하세요.",
            code:
              error instanceof DomainError
                ? String(error.status)
                : "NAVIGATION_FAILED",
          }),
        );
    } finally {
      response.end();
    }
  }
  @Post("commands") async command(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const command = commandSchema.parse(body) as Command;
    return projectView(await this.store.command(req.actor, command), req.actor);
  }
  @Get("events") async events(
    @Req() req: AuthRequest,
    @Res() response: Response,
  ) {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    let previous = "",
      busy = false,
      ticks = 0;
    const send = async () => {
      if (busy || response.writableEnded) return;
      busy = true;
      try {
        const session = await this.store.session(req.cookies.caidentia_session);
        const view = await this.store.view(session.actor);
        const hash = digest(JSON.stringify(view));
        if (hash !== previous) {
          response.write(
            `id: ${hash}\ndata: ${JSON.stringify({ revision: view.version })}\n\n`,
          );
          previous = hash;
        } else if (++ticks % 15 === 0) response.write(": keepalive\n\n");
      } catch {
        response.write("event: revoked\ndata: {}\n\n");
        response.end();
      } finally {
        busy = false;
      }
    };
    await send();
    const timer = setInterval(() => void send(), 1000);
    req.on("close", () => clearInterval(timer));
  }
  @Get("bom") async bom(
    @Req() req: AuthRequest,
    @Query("q") query = "",
    @Query("offset") offset = "0",
    @Query("revision") revision?: string,
    @Query("view") view = "list",
  ) {
    z.enum(["list", "hierarchy"]).parse(view);
    const state = await this.store.read(req.actor);
    if (req.actor.supplier) {
      const c = state.suppliers[req.actor.supplier];
      const mapping = await this.store.transaction(
        req.actor.tenant,
        async (client) =>
          (
            await client.query(
              "SELECT mapping FROM boms WHERE tenant=$1 AND revision=$2",
              [req.actor.tenant, state.bomRevision],
            )
          ).rows[0].mapping as BomMapping,
      );
      const published = {
        part: `PSU-${c.key}`,
        revision: `v${c.request.revision}`,
        name: "공개 요청 전원 모듈",
        quantity: c.request.quantity,
        unit: "EA",
        configuration: `공개 사양 ${c.request.specification}`,
      };
      const columns = mapping.sharedFields;
      const row = {
        occurrence: "REQUEST-PSU",
        ...Object.fromEntries(
          columns.map((field) => [
            field,
            published[field as keyof typeof published],
          ]),
        ),
      };
      return {
        rows: [row],
        columns,
        total: 1,
        revision: c.request.revision,
        scope: "published",
      };
    }
    const index = z.coerce.number().int().min(0).max(10000).parse(offset),
      selectedRevision = revision
        ? z.coerce.number().int().positive().parse(revision)
        : state.bomRevision;
    return this.store.transaction(req.actor.tenant, async (client) => {
      const result = await client.query(
        "SELECT rows,mapping FROM boms WHERE tenant=$1 AND project_id=$2 AND revision=$3",
        [req.actor.tenant, state.id, selectedRevision],
      );
      ensure(result.rowCount, "BOM 개정을 찾을 수 없습니다.", 404);
      const rows = (result.rows[0].rows as BomRow[]).filter(
        (r) =>
          view === "hierarchy" ||
          !query ||
          [r.part, r.name, r.occurrence].some((v) =>
            v.toLowerCase().includes(query.slice(0, 100).toLowerCase()),
          ),
      );
      return {
        rows: view === "hierarchy" ? rows : rows.slice(index, index + 200),
        total: rows.length,
        revision: selectedRevision,
        scope: "internal",
        columns: (result.rows[0].mapping as BomMapping).visibleColumns,
      };
    });
  }
  @Get("bom/template/:id") template(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    ensure(has(req.actor, "admin"), "설정 권한이 필요합니다.", 403);
    const mapping = defaultMappings.find((m) => m.id === id);
    ensure(mapping, "양식을 찾을 수 없습니다.", 404);
    const fields = Object.keys(mapping.columns);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="bom-${mapping.id}.csv"`,
    );
    response
      .type("text/csv")
      .send(
        csvExport([
          fields.map((f) => mapping.columns[f]),
          ...seedBom().map((row) =>
            fields.map((field) => String(row[field as keyof BomRow] ?? "")),
          ),
        ]),
      );
  }
  @Post("bom/preview") async preview(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    ensure(has(req.actor, "admin"), "BOM 설정 권한이 필요합니다.", 403);
    const input = inputSchema.parse(body),
      parsed = await parseInput(input),
      mapped = mapBom(parsed.headers, parsed.values, input.mapping);
    return {
      headers: parsed.headers,
      rows: mapped.rows.slice(0, 20),
      total: mapped.rows.length,
      errors: mapped.errors.slice(0, 100),
      errorCount: mapped.errors.length,
    };
  }
  @Post("bom/publish") async publishBom(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    ensure(has(req.actor, "admin"), "BOM 설정 권한이 필요합니다.", 403);
    const input = inputSchema
      .extend({
        expectedVersion: z.number().int().positive(),
        requestId: z.uuid(),
      })
      .parse(body);
    const parsed = await parseInput(input),
      mapped = mapBom(parsed.headers, parsed.values, input.mapping);
    ensure(!mapped.errors.length, "검증 오류를 수정한 뒤 발행하세요.");
    return this.store.transaction(req.actor.tenant, async (client) => {
      const result = await client.query(
        "SELECT state FROM workspaces WHERE tenant=$1 FOR UPDATE",
        [req.actor.tenant],
      );
      const state = result.rows[0].state as Project;
      checkAccess(state, req.actor);
      const hash = digest(JSON.stringify(input)),
        prior = await client.query(
          "SELECT hash FROM requests WHERE tenant=$1 AND actor_id=$2 AND request_id=$3",
          [req.actor.tenant, req.actor.id, input.requestId],
        );
      if (prior.rowCount) {
        ensure(
          prior.rows[0].hash === hash,
          "요청 식별자가 다른 내용에 사용되었습니다.",
          409,
        );
        return { revision: state.bomRevision };
      }
      ensure(
        state.version === input.expectedVersion,
        "최신 BOM 상태를 확인하세요.",
        409,
      );
      const previous = state.mappings.find((m) => m.id === mapped.mapping.id),
        mapping = {
          ...mapped.mapping,
          revision: (previous?.revision ?? 0) + 1,
        };
      state.mappings = [
        ...state.mappings.filter((m) => m.id !== mapping.id),
        mapping,
      ];
      state.bomRevision++;
      state.bomCount = mapped.rows.length;
      state.version++;
      for (const c of Object.values(state.suppliers)) {
        const previousConfig = c.configurations.at(-1)!;
        c.configurations.push({
          ...previousConfig,
          revision: previousConfig.revision + 1,
          bomRevision: state.bomRevision,
          state: "reviewing",
          technical: { state: "reviewing", evidence: "" },
          quality: { state: "reviewing", evidence: "" },
        });
      }
      state.activities.push({
        id: randomUUID(),
        action: "bom.publish",
        title: `BOM R${state.bomRevision} 발행 · 재검토 필요`,
        actor: req.actor.name,
        channel: "internal",
        at: new Date().toISOString(),
        reference: `BOM R${state.bomRevision} · ${mapping.name} v${mapping.revision}`,
      });
      await client.query(
        "INSERT INTO boms(tenant,project_id,revision,mapping,rows) VALUES($1,$2,$3,$4,$5)",
        [
          req.actor.tenant,
          state.id,
          state.bomRevision,
          mapping,
          JSON.stringify(mapped.rows),
        ],
      );
      await this.store.save(client, state, req.actor, "bom.publish");
      await client.query(
        "INSERT INTO requests(tenant,actor_id,request_id,hash) VALUES($1,$2,$3,$4)",
        [req.actor.tenant, req.actor.id, input.requestId, hash],
      );
      return { revision: state.bomRevision };
    });
  }
  @Get("files") async files(
    @Req() req: AuthRequest,
    @Query("channel") channel: string,
  ) {
    this.fileScope(req.actor, channel);
    return this.store.transaction(
      req.actor.tenant,
      async (client) =>
        (
          await client.query(
            "SELECT id,name,mime,octet_length(content) AS bytes,created_at FROM files WHERE tenant=$1 AND channel=$2 ORDER BY created_at",
            [req.actor.tenant, channel],
          )
        ).rows,
    );
  }
  fileScope(actor: Actor, channel: string) {
    ensure(["A", "B", "internal"].includes(channel), "공개 대상을 확인하세요.");
    if (actor.supplier)
      ensure(actor.supplier === channel, "파일을 찾을 수 없습니다.", 404);
    else
      ensure(
        has(actor, "buyer", "approver"),
        "협의 자료 권한이 없습니다.",
        403,
      );
  }
  @Post("files") async upload(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = z
      .object({
        channel: z.enum(["A", "B", "internal"]),
        name: z
          .string()
          .min(1)
          .max(150)
          .regex(/^[^/\\\r\n]+$/),
        requestId: z.uuid(),
        mime: z.enum([
          "application/pdf",
          "image/png",
          "image/jpeg",
          "text/plain",
        ]),
        content: z.string().max(1400000),
      })
      .strict()
      .parse(body);
    this.fileScope(req.actor, input.channel);
    ensure(
      has(req.actor, "supplier", "buyer", "designer", "quality"),
      "업로드 권한이 없습니다.",
      403,
    );
    const content = Buffer.from(input.content, "base64");
    ensure(
      content.length > 0 && content.length <= 1024 * 1024,
      "첨부파일은 1 MB 이하로 사용하세요.",
      413,
    );
    return this.store.transaction(req.actor.tenant, async (client) => {
      const state = (
        await client.query(
          "SELECT state FROM workspaces WHERE tenant=$1 FOR UPDATE",
          [req.actor.tenant],
        )
      ).rows[0].state as Project;
      checkAccess(state, req.actor);
      const hash = digest(JSON.stringify(input)),
        id = input.requestId;
      const prior = await client.query(
        "SELECT hash FROM requests WHERE tenant=$1 AND actor_id=$2 AND request_id=$3",
        [req.actor.tenant, req.actor.id, id],
      );
      if (prior.rowCount) {
        ensure(
          prior.rows[0].hash === hash,
          "요청 식별자가 다른 내용에 사용되었습니다.",
          409,
        );
        return { id, name: input.name };
      }
      await client.query(
        "INSERT INTO files(id,tenant,project_id,channel,name,mime,content,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          req.actor.tenant,
          state.id,
          input.channel,
          input.name,
          input.mime,
          content,
          req.actor.id,
        ],
      );
      state.version++;
      if (input.channel !== "internal")
        state.suppliers[input.channel].revision++;
      state.activities.push({
        id: randomUUID(),
        action: "file.upload",
        title: "협의 자료 추가",
        actor: req.actor.name,
        channel: input.channel,
        at: new Date().toISOString(),
        reference: "협의 자료",
      });
      await this.store.save(client, state, req.actor, "file.upload");
      await client.query(
        "INSERT INTO requests(tenant,actor_id,request_id,hash) VALUES($1,$2,$3,$4)",
        [req.actor.tenant, req.actor.id, id, hash],
      );
      return { id, name: input.name };
    });
  }
  @Get("files/:id") async download(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    return this.store.transaction(req.actor.tenant, async (client) => {
      const result = await client.query(
        "SELECT * FROM files WHERE tenant=$1 AND id=$2",
        [req.actor.tenant, id],
      );
      ensure(result.rowCount, "파일을 찾을 수 없습니다.", 404);
      const file = result.rows[0];
      this.fileScope(req.actor, file.channel);
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.type("application/octet-stream").send(file.content);
    });
  }
  @Get("history") async history(@Req() req: AuthRequest) {
    ensure(
      has(req.actor, "buyer", "approver"),
      "내부 결정 이력 권한이 필요합니다.",
      403,
    );
    return this.store.transaction(
      req.actor.tenant,
      async (client) =>
        (
          await client.query(
            "SELECT version,action,actor_id,created_at FROM decisions WHERE tenant=$1 ORDER BY version DESC LIMIT 100",
            [req.actor.tenant],
          )
        ).rows,
    );
  }
  @Get("history/:version") async snapshot(
    @Req() req: AuthRequest,
    @Param("version") version: string,
  ) {
    ensure(
      has(req.actor, "buyer", "approver"),
      "내부 결정 이력 권한이 필요합니다.",
      403,
    );
    return this.store.transaction(req.actor.tenant, async (client) => {
      const result = await client.query(
        "SELECT snapshot,created_at FROM decisions WHERE tenant=$1 AND version=$2",
        [req.actor.tenant, z.coerce.number().int().positive().parse(version)],
      );
      ensure(result.rowCount, "이력을 찾을 수 없습니다.", 404);
      return {
        historical: true,
        workspace: projectView(
          result.rows[0].snapshot,
          req.actor,
          new Date(result.rows[0].created_at).getTime(),
        ),
      };
    });
  }
  @Get("handoff/:id") async handoff(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    ensure(has(req.actor, "buyer", "approver"), "인계 권한이 필요합니다.", 403);
    const state = await this.store.read(req.actor),
      award = state.awards.find((a) => a.id === id);
    ensure(
      award?.state === "approved" && award.handedOffAt,
      "인계 기록을 먼저 생성하세요.",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="selection-${award.id}.json"`,
    );
    response.json({
      project: state.id,
      award,
      notice: "선정 근거 파일입니다. 계약·발주·ERP 등록을 실행하지 않습니다.",
    });
  }
  @Get("facts") async facts(@Req() req: AuthRequest) {
    const view = await this.store.view(req.actor);
    return {
      reference: `${view.requirement.id} v${view.requirement.revision}`,
      version: view.version,
      metrics: view.metrics,
      suppliers: view.suppliers.map((c) => ({
        key: c.key,
        specification: c.request.specification,
        configuration: c.configuration.state,
        technical: c.configuration.technical.state,
        quality: c.configuration.quality.state,
        commitment: c.commitment?.status,
        publishedAwards: c.publishedAwards,
        reasons: c.readiness?.reasons,
      })),
      activities: view.activities
        .slice(-8)
        .map((e) => ({ title: e.title, reference: e.reference })),
    };
  }
}

@Module({
  controllers: [ApiController],
  providers: [{ provide: Store, useFactory: () => new Store() }],
})
class AppModule {}
export async function bootstrap(port = Number(process.env.API_PORT ?? 4310)) {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });
  const store = app.get(Store);
  await store.initialize();
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "data:", "blob:"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "connect-src": ["'self'"],
        },
      },
    }),
  );
  app.use(json({ limit: "3mb" }));
  app.use(cookieParser());
  app.use(async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();
    const started = performance.now();
    res.on("finish", () => {
      if (req.path !== "/api/events" && req.path !== "/api/health")
        console.log(
          JSON.stringify({
            method: req.method,
            path: req.path.split("?")[0],
            status: res.statusCode,
            ms: Math.round(performance.now() - started),
          }),
        );
    });
    res.setHeader("Cache-Control", "no-store");
    try {
      if (req.method !== "GET") {
        const origin = req.headers.origin;
        ensure(
          origin === (process.env.APP_ORIGIN ?? "http://127.0.0.1:5173") ||
            origin === "http://localhost:5173",
          "허용되지 않은 요청 출처입니다.",
          403,
        );
      }
      if (!["/api/login", "/api/health"].includes(req.path)) {
        const session = await store.session(req.cookies.caidentia_session);
        req.actor = session.actor;
        req.csrf = session.csrf;
        if (req.method !== "GET")
          ensure(
            req.headers["x-csrf-token"] === session.csrf,
            "요청 인증을 다시 확인하세요.",
            403,
          );
      }
      next();
    } catch (error) {
      const status = error instanceof DomainError ? error.status : 500;
      res.status(status).json({
        message:
          error instanceof DomainError
            ? error.message
            : "요청을 처리하지 못했습니다.",
      });
    }
  });
  app.useGlobalFilters({
    catch(error: unknown, host) {
      const response = host.switchToHttp().getResponse<Response>();
      const status =
        error instanceof DomainError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : error instanceof HttpException
              ? error.getStatus()
              : 500;
      if (status === 500) console.error(error);
      response.status(status).json({
        message:
          error instanceof DomainError
            ? error.message
            : error instanceof z.ZodError
              ? "입력 값의 형식과 필수 항목을 확인하세요."
              : "요청을 처리하지 못했습니다.",
      });
    },
  });
  if (existsSync("dist/index.html")) {
    app.use(serveStatic(resolve("dist")));
    app.use((req: Request, res: Response, next: NextFunction) =>
      req.method === "GET" && !req.path.startsWith("/api")
        ? res.sendFile(resolve("dist/index.html"))
        : next(),
    );
  }
  await app.listen(port, "127.0.0.1");
  console.log(`D2S API 준비 완료 · http://127.0.0.1:${port}`);
  return { app, store };
}
if (process.env.NODE_ENV !== "test") void bootstrap();
