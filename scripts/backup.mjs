import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Pool } from "pg";
import { exportBackup, restoreBackup } from "../src/server/backup.ts";

const [operation, path] = process.argv.slice(2);
let url = process.env.MIGRATION_DATABASE_URL;
if (!url && operation === "export" && existsSync(".data/database.json")) {
  const c = JSON.parse(readFileSync(".data/database.json", "utf8"));
  url = `postgresql://postgres:${c.adminPassword}@127.0.0.1:${c.port}/caidentia`;
}
if (!["export", "restore"].includes(operation) || !path || !url)
  throw new Error(
    "Usage: MIGRATION_DATABASE_URL=... npm run backup -- export|restore <private-file.json>",
  );
const pool = new Pool({ connectionString: url });
try {
  if (operation === "export")
    writeFileSync(path, JSON.stringify(await exportBackup(pool)), {
      mode: 0o600,
      flag: "wx",
    });
  else await restoreBackup(pool, JSON.parse(readFileSync(path, "utf8")));
  console.log(
    operation === "export"
      ? "백업 저장 완료. 세션은 포함하지 않습니다."
      : "빈 데이터베이스 복원 완료. 다시 로그인하세요.",
  );
} finally {
  await pool.end();
}
