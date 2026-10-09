import { Pool, type PoolClient } from "pg";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Actor, Command, Project } from "../shared/model.js";
import {
  applyCommand,
  checkAccess,
  DomainError,
  ensure,
  projectView,
} from "./domain.js";
import { demoActors, seedBom, seedProject } from "./seed.js";

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, value] = stored.split(":");
  const expected = Buffer.from(value, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export class Store {
  pool: Pool;
  constructor(url = process.env.DATABASE_URL) {
    ensure(url, "DATABASE_URL을 설정하세요.", 500);
    this.pool = new Pool({ connectionString: url, max: 12 });
  }
  async initialize() {
    const migration = new Pool({
      connectionString:
        process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
    });
    try {
      await migration.query(`
        CREATE TABLE IF NOT EXISTS actors (id text PRIMARY KEY, email text UNIQUE NOT NULL, password text NOT NULL, profile jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, actor_id text NOT NULL REFERENCES actors(id), csrf text NOT NULL, expires_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS workspaces (id text PRIMARY KEY, tenant text UNIQUE NOT NULL, state jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS decisions (id bigserial PRIMARY KEY, tenant text NOT NULL, project_id text NOT NULL, version integer NOT NULL, actor_id text NOT NULL, action text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,version));
        CREATE TABLE IF NOT EXISTS requests (tenant text NOT NULL, actor_id text NOT NULL, request_id text NOT NULL, hash text NOT NULL, PRIMARY KEY(tenant,actor_id,request_id));
        CREATE TABLE IF NOT EXISTS boms (tenant text NOT NULL, project_id text NOT NULL, revision integer NOT NULL, mapping jsonb NOT NULL, rows jsonb NOT NULL, PRIMARY KEY(tenant,project_id,revision));
        CREATE TABLE IF NOT EXISTS files (id text PRIMARY KEY, tenant text NOT NULL, project_id text NOT NULL, channel text NOT NULL CHECK(channel IN ('A','B','internal')), name text NOT NULL, mime text NOT NULL, content bytea NOT NULL, actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX IF NOT EXISTS files_scope ON files(tenant,project_id,channel);
        CREATE INDEX IF NOT EXISTS decisions_scope ON decisions(tenant,project_id,version);
      `);
      for (const table of [
        "workspaces",
        "decisions",
        "requests",
        "boms",
        "files",
      ]) {
        await migration.query(
          `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS tenant_scope ON ${table}; CREATE POLICY tenant_scope ON ${table} USING (tenant = current_setting('app.tenant',true)) WITH CHECK (tenant = current_setting('app.tenant',true));`,
        );
      }
      await migration.query(
        "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO caidentia_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO caidentia_app; REVOKE UPDATE,DELETE ON decisions FROM caidentia_app;",
      );
      if (process.env.DEMO_MODE === "true") {
        for (const actor of demoActors)
          await migration.query(
            "INSERT INTO actors(id,email,password,profile) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
            [actor.id, actor.email, passwordHash("D2S-demo-2026!"), actor],
          );
        for (const tenant of ["buyer-demo", "buyer-reuse"]) {
          const state = seedProject(tenant);
          await migration.query(
            "INSERT INTO workspaces(id,tenant,state) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
            [state.id, tenant, state],
          );
          await migration.query(
            "INSERT INTO boms(tenant,project_id,revision,mapping,rows) VALUES($1,$2,1,$3,$4) ON CONFLICT DO NOTHING",
            [
              tenant,
              state.id,
              JSON.stringify(state.mappings[0]),
              JSON.stringify(seedBom()),
            ],
          );
        }
      }
    } finally {
      await migration.end();
    }
  }
  async transaction<T>(
    tenant: string,
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant',$1,true)", [tenant]);
      const value = await callback(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async login(email: string, password: string) {
    const result = await this.pool.query(
      "SELECT password,profile FROM actors WHERE email=$1",
      [email],
    );
    const row = result.rows[0];
    ensure(
      row && verifyPassword(password, row.password) && row.profile.active,
      "이메일 또는 비밀번호를 확인하세요.",
      401,
    );
    const actor = row.profile as Actor;
    await this.read(actor);
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    await this.pool.query(
      "INSERT INTO sessions(token,actor_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
      [digest(token), actor.id, csrf],
    );
    return { token, csrf, actor };
  }
  async session(token: string | undefined) {
    ensure(token && /^[a-f0-9]{64}$/.test(token), "로그인이 필요합니다.", 401);
    const result = await this.pool.query(
      "SELECT a.profile,s.csrf FROM sessions s JOIN actors a ON a.id=s.actor_id WHERE s.token=$1 AND s.expires_at>now()",
      [digest(token)],
    );
    ensure(
      result.rowCount && result.rows[0].profile.active,
      "세션이 만료되었습니다.",
      401,
    );
    const actor = result.rows[0].profile as Actor;
    await this.read(actor);
    return { actor, csrf: result.rows[0].csrf as string };
  }
  async read(actor: Actor, client?: PoolClient): Promise<Project> {
    const run = async (connection: PoolClient) => {
      const result = await connection.query(
        "SELECT state FROM workspaces WHERE tenant=$1",
        [actor.tenant],
      );
      ensure(result.rowCount, "프로젝트를 찾을 수 없습니다.", 404);
      const state = result.rows[0].state as Project;
      checkAccess(state, actor);
      return state;
    };
    return client ? run(client) : this.transaction(actor.tenant, run);
  }
  async command(actor: Actor, command: Command) {
    return this.transaction(actor.tenant, async (client) => {
      // ponytail: one portfolio lock protects this demo's shared supply. Split by supply source when independent project throughput requires it.
      const result = await client.query(
        "SELECT state FROM workspaces WHERE tenant=$1 FOR UPDATE",
        [actor.tenant],
      );
      ensure(result.rowCount, "프로젝트를 찾을 수 없습니다.", 404);
      const state = result.rows[0].state as Project;
      checkAccess(state, actor);
      const hash = digest(
        JSON.stringify({
          action: command.action,
          expectedVersion: command.expectedVersion,
          payload: command.payload,
        }),
      );
      const prior = await client.query(
        "SELECT hash FROM requests WHERE tenant=$1 AND actor_id=$2 AND request_id=$3",
        [actor.tenant, actor.id, command.requestId],
      );
      if (prior.rowCount) {
        ensure(
          prior.rows[0].hash === hash,
          "같은 요청 식별자가 다른 내용에 사용되었습니다.",
          409,
        );
        return state;
      }
      if (command.action === "membership.revoke") {
        const target = await client.query(
          "SELECT profile FROM actors WHERE id=$1",
          [command.payload.actorId],
        );
        ensure(
          target.rowCount && target.rows[0].profile.tenant === actor.tenant,
          "참여자를 찾을 수 없습니다.",
          404,
        );
      }
      const next = applyCommand(state, actor, command);
      await this.save(client, next, actor, command.action);
      await client.query(
        "INSERT INTO requests(tenant,actor_id,request_id,hash) VALUES($1,$2,$3,$4)",
        [actor.tenant, actor.id, command.requestId, hash],
      );
      return next;
    });
  }
  async save(client: PoolClient, state: Project, actor: Actor, action: string) {
    await client.query("UPDATE workspaces SET state=$1 WHERE tenant=$2", [
      state,
      actor.tenant,
    ]);
    await client.query(
      "INSERT INTO decisions(tenant,project_id,version,actor_id,action,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
      [actor.tenant, state.id, state.version, actor.id, action, state],
    );
  }
  async view(actor: Actor) {
    return projectView(await this.read(actor), actor);
  }
  async close() {
    await this.pool.end();
  }
}
