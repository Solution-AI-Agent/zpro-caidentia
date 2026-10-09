import Ajv from "ajv";
import { parse } from "csv-parse/sync";
import readExcelFile from "read-excel-file/node";
import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import type { BomMapping, BomRow } from "../shared/model.js";
import { indexBom } from "../shared/bom.js";
import { DomainError, ensure } from "./domain.js";

const coreFields = [
  "occurrence",
  "parent",
  "part",
  "revision",
  "name",
  "quantity",
  "unit",
  "configuration",
  "category",
];
export const mappingSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),
    revision: z.number().int().min(1),
    name: z.string().min(1).max(100),
    columns: z.record(
      z
        .string()
        .regex(
          /^(occurrence|parent|part|revision|name|quantity|unit|configuration|category|attr\.[a-zA-Z][a-zA-Z0-9_]{0,30})$/,
        ),
      z.string().max(100),
    ),
    unitMap: z.record(z.string().max(30), z.literal("EA")),
    visibleColumns: z.array(z.string()).max(32),
    sharedFields: z
      .array(
        z.enum([
          "part",
          "revision",
          "name",
          "quantity",
          "unit",
          "configuration",
        ]),
      )
      .max(6),
    required: z.array(z.string()).max(32),
  })
  .strict();
const ajv = new Ajv({ allErrors: true });
const rowValidator = ajv.compile({
  type: "object",
  required: ["occurrence", "part", "quantity", "unit"],
  properties: {
    occurrence: { type: "string", minLength: 1, maxLength: 100 },
    part: { type: "string", minLength: 1, maxLength: 100 },
    quantity: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
    unit: { const: "EA" },
  },
});
export async function parseInput(input: {
  content: string;
  format: "csv" | "xlsx";
}) {
  try {
    return await parseContent(input);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      400,
      "파일 형식을 읽을 수 없습니다. CSV 또는 값으로 된 XLSX를 확인하세요.",
    );
  }
}
async function parseContent(input: {
  content: string;
  format: "csv" | "xlsx";
}) {
  ensure(
    input.content.length <= 2800000,
    "입력 파일은 2 MB 이하로 제한합니다.",
    413,
  );
  let rows: string[][];
  if (input.format === "xlsx") {
    const buffer = Buffer.from(input.content, "base64");
    let expanded = 0;
    const entries = unzipSync(buffer, {
      filter: (entry) => {
        expanded += entry.originalSize;
        ensure(
          expanded <= 16 * 1024 * 1024,
          "압축 해제된 자료가 16 MB를 초과합니다.",
          413,
        );
        return true;
      },
    });
    for (const [name, bytes] of Object.entries(entries)) {
      ensure(
        !name.endsWith("vbaProject.bin"),
        "매크로 파일은 지원하지 않습니다.",
      );
      if (/^xl\/worksheets\/.*\.xml$/.test(name))
        ensure(
          !/<(?:\w+:)?(?:f|mergeCell)\b/.test(strFromU8(bytes)),
          "수식·병합 셀을 값과 명시적 열로 변환하세요.",
        );
    }
    const sheets = await readExcelFile(buffer);
    ensure(sheets.length === 1, "한 개 시트의 XLSX 파일을 사용하세요.");
    rows = sheets[0].data.map((row) =>
      row.map((value) => (value == null ? "" : String(value))),
    );
  } else {
    rows = parse(input.content, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 32768,
      trim: true,
    });
  }
  ensure(
    rows.length >= 2 && rows.length <= 10001,
    "헤더와 1~10,000개 자료 행을 사용하세요.",
  );
  const headers = rows[0].map((s) => s.trim());
  ensure(
    headers.length <= 32 &&
      new Set(headers).size === headers.length &&
      headers.every(Boolean),
    "열 이름은 비어 있거나 중복될 수 없으며 32개 이하여야 합니다.",
  );
  ensure(
    rows.every((r) => r.length === headers.length),
    "행마다 열 수가 같아야 합니다.",
  );
  return { headers, values: rows.slice(1) };
}
export function mapBom(
  headers: string[],
  values: string[][],
  inputMapping: BomMapping,
) {
  const mapping = mappingSchema.parse(inputMapping);
  const errors: Array<{ row: number; field: string; message: string }> = [];
  for (const field of ["occurrence", "part", "quantity", "unit"])
    ensure(
      mapping.columns[field] && headers.includes(mapping.columns[field]),
      `${field}의 원본 열을 연결하세요.`,
    );
  const allowed = new Set([
    ...coreFields,
    ...Object.keys(mapping.columns).filter((k) => k.startsWith("attr.")),
  ]);
  ensure(
    [...mapping.required, ...mapping.visibleColumns].every((k) =>
      allowed.has(k),
    ),
    "지원하지 않는 설정 필드가 있습니다.",
  );
  const rows: BomRow[] = values.map((source, index) => {
    const value = (field: string) =>
      (source[headers.indexOf(mapping.columns[field])] ?? "").trim();
    const rawQuantity = value("quantity");
    const row: BomRow = {
      occurrence: value("occurrence"),
      parent: value("parent"),
      part: value("part"),
      revision: value("revision"),
      name: value("name"),
      quantity: rawQuantity === "" ? NaN : Number(rawQuantity),
      unit: mapping.unitMap[value("unit")] ?? "",
      configuration: value("configuration"),
      category: value("category"),
      attributes: Object.fromEntries(
        Object.keys(mapping.columns)
          .filter((k) => k.startsWith("attr."))
          .map((k) => [k.slice(5), value(k)]),
      ),
    };
    if (!rowValidator(row))
      for (const error of rowValidator.errors ?? [])
        errors.push({
          row: index + 2,
          field:
            error.instancePath.slice(1) ||
            String(error.params.missingProperty ?? ""),
          message:
            error.keyword === "const"
              ? "등록한 단위 변환을 확인하세요."
              : "필수 값·형식·범위를 확인하세요.",
        });
    for (const field of mapping.required)
      if (!value(field))
        errors.push({
          row: index + 2,
          field,
          message: "필수 항목이 비어 있습니다.",
        });
    if (source.some((cell) => cell.length > 4000))
      errors.push({
        row: index + 2,
        field: "row",
        message: "셀은 4,000자 이하로 입력하세요.",
      });
    return row;
  });
  errors.push(...indexBom(rows).errors);
  return { rows, errors, mapping };
}
export function csvExport(rows: Array<Array<string | number>>) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let safe = String(value);
            if (/^[=+@\-\t\r]/.test(safe)) safe = "'" + safe;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
