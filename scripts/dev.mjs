import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { startDatabase } from "./database.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const db = process.env.DATABASE_URL ? null : await startDatabase();
const env = {
  ...process.env,
  DEMO_MODE: "true",
  ...(db
    ? { DATABASE_URL: db.appUrl, MIGRATION_DATABASE_URL: db.migrationUrl }
    : {}),
};
const processes = [
  spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "watch", "src/server/main.ts"],
    { env, stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { env, stdio: "inherit" },
  ),
];
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const p of processes) p.kill("SIGTERM");
  await db?.stop();
  process.exit(code);
}
for (const p of processes)
  p.on("exit", (code) => {
    if (!closing) void close(code ?? 1);
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void close());
