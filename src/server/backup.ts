import type { Pool } from "pg";
import { ensure } from "./domain.js";

const tables = [
  "actors",
  "workspaces",
  "decisions",
  "requests",
  "boms",
  "files",
] as const;
type Table = (typeof tables)[number];
export interface Backup {
  format: 1;
  createdAt: string;
  tables: Record<Table, Record<string, unknown>[]>;
}

export async function exportBackup(pool: Pool): Promise<Backup> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const data = {} as Backup["tables"];
    for (const table of tables) {
      const rows = (await client.query(`SELECT * FROM ${table}`)).rows;
      data[table] = rows.map((row) =>
        table === "files"
          ? { ...row, content: row.content.toString("base64") }
          : row,
      );
    }
    await client.query("COMMIT");
    return { format: 1, createdAt: new Date().toISOString(), tables: data };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function restoreBackup(pool: Pool, backup: Backup) {
  ensure(
    backup.format === 1 &&
      tables.every((table) => Array.isArray(backup.tables?.[table])),
    "지원하는 백업 형식이 아닙니다.",
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `LOCK TABLE sessions, ${tables.join(", ")} IN ACCESS EXCLUSIVE MODE`,
    );
    for (const table of [...tables, "sessions"])
      ensure(
        (await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]
          .n === 0,
        "빈 데이터베이스에만 복원할 수 있습니다.",
      );
    for (const table of tables) {
      const columns = (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
          ["public", table],
        )
      ).rows.map((r) => r.column_name as string);
      for (const row of backup.tables[table]) {
        ensure(
          Object.keys(row).every((key) => columns.includes(key)) &&
            columns.every((key) => key in row),
          "백업 열과 복원 스키마가 일치하지 않습니다.",
        );
        const values = columns.map((key) =>
          table === "files" && key === "content"
            ? Buffer.from(String(row[key]), "base64")
            : row[key] != null &&
                typeof row[key] === "object" &&
                !(row[key] instanceof Date)
              ? JSON.stringify(row[key])
              : row[key],
        );
        await client.query(
          `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
          values,
        );
      }
    }
    await client.query(
      "SELECT setval(pg_get_serial_sequence('decisions','id'),COALESCE((SELECT max(id) FROM decisions),1),(SELECT count(*)>0 FROM decisions))",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
