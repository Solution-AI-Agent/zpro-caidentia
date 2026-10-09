import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { startDatabase } from "./database.mjs";

// Tests always use a disposable local database, never the application's database.
let db, admin;
if (!existsSync(".data/database.json")) db = await startDatabase();
const credentials = JSON.parse(readFileSync(".data/database.json", "utf8"));
const adminBase = `postgresql://postgres:${credentials.adminPassword}@127.0.0.1:${credentials.port}`;
admin = new Pool({
  connectionString: `${adminBase}/postgres`,
  connectionTimeoutMillis: 1500,
});
try {
  await admin.query("SELECT 1");
} catch {
  await admin.end();
  db = await startDatabase();
  admin = new Pool({ connectionString: `${adminBase}/postgres` });
}
const name = `caidentia_test_${randomBytes(6).toString("hex")}`;
let code = 1;
try {
  await admin.query(`CREATE DATABASE ${name}`);
  const child = spawn(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DEMO_MODE: "true",
        DATABASE_URL: `postgresql://caidentia_app:${credentials.appPassword}@127.0.0.1:${credentials.port}/${name}`,
        MIGRATION_DATABASE_URL: `${adminBase}/${name}`,
      },
    },
  );
  code = await new Promise((resolve) =>
    child.on("exit", (exit) => resolve(exit ?? 1)),
  );
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
  await db?.stop();
}
process.exitCode = code;
