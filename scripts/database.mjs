import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function startDatabase() {
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  const credentialsPath = resolve(".data/database.json");
  if (!existsSync(credentialsPath)) {
    const adminPassword = randomBytes(24).toString("hex"),
      appPassword = randomBytes(24).toString("hex");
    writeFileSync(
      credentialsPath,
      JSON.stringify({ adminPassword, appPassword, port: 54329 }),
      { mode: 0o600 },
    );
  }
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
  const db = new EmbeddedPostgres({
    databaseDir: resolve(".data/postgres"),
    user: "postgres",
    password: credentials.adminPassword,
    port: credentials.port,
    persistent: true,
    authMethod: "scram-sha-256",
    createPostgresUser: false,
    postgresFlags: [
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      `unix_socket_directories=${resolve(".data")}`,
    ],
    onLog: () => {},
    onError: (message) => {
      if (String(message).includes("FATAL"))
        console.error("PostgreSQL:", String(message));
    },
  });
  if (!existsSync(".data/postgres/PG_VERSION")) await db.initialise();
  await db.start();
  const client = db.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  if (
    !(
      await client.query(
        "SELECT 1 FROM pg_database WHERE datname = 'caidentia'",
      )
    ).rowCount
  )
    await db.createDatabase("caidentia");
  if (
    !(
      await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname = 'caidentia_app'",
      )
    ).rowCount
  ) {
    if (!/^[a-f0-9]{48}$/.test(credentials.appPassword))
      throw new Error("Invalid local database credential format");
    await client.query(
      `CREATE ROLE caidentia_app LOGIN NOSUPERUSER NOINHERIT PASSWORD '${credentials.appPassword}'`,
    );
  }
  await client.end();
  const migrationUrl = `postgresql://postgres:${credentials.adminPassword}@127.0.0.1:${credentials.port}/caidentia`;
  const appUrl = `postgresql://caidentia_app:${credentials.appPassword}@127.0.0.1:${credentials.port}/caidentia`;
  return { stop: () => db.stop(), migrationUrl, appUrl };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = await startDatabase();
  console.log("개발용 PostgreSQL 준비 완료 · 127.0.0.1:54329");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await db.stop();
      process.exit(0);
    });
  setInterval(() => {}, 60000);
}
