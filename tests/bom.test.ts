import { describe, expect, it } from "vitest";
import { csvExport, mapBom, parseInput } from "../src/server/bom.js";
import { defaultMappings, seedBom } from "../src/server/seed.js";
import { strToU8, zipSync } from "fflate";
import {
  bomPath,
  indexBom,
  searchBom,
  visibleBomNodes,
} from "../src/shared/bom.js";

describe("no-code BOM inputs", () => {
  it.each(defaultMappings)(
    "$name maps to the same core representation",
    async (mapping) => {
      const fields = Object.keys(mapping.columns);
      const content = csvExport([
        fields.map((f) => mapping.columns[f]),
        ...seedBom().map((row) =>
          fields.map((f) => String(row[f as keyof typeof row])),
        ),
      ]);
      const parsed = await parseInput({ content, format: "csv" });
      const result = mapBom(parsed.headers, parsed.values, mapping);
      expect(result.errors).toEqual([]);
      expect(result.rows).toEqual(seedBom());
    },
  );
  it("validates required attributes, unit aliases, duplicate paths, cycles and missing parents", () => {
    const mapping = structuredClone(defaultMappings[0]);
    mapping.columns["attr.certification"] = "인증";
    mapping.required.push("attr.certification");
    const fields = Object.keys(mapping.columns),
      headers = fields.map((f) => mapping.columns[f]);
    const row = (
      occurrence: string,
      parent: string,
      quantity = "2",
      unit = "개",
      cert = "PASS",
    ) => [
      occurrence,
      parent,
      "PSU-A",
      "R1",
      "모듈",
      quantity,
      unit,
      "C1",
      "전원",
      cert,
    ];
    const valid = mapBom(headers, [row("root", "")], mapping);
    expect(valid.errors).toEqual([]);
    expect(valid.rows[0]).toMatchObject({
      unit: "EA",
      attributes: { certification: "PASS" },
    });
    expect(
      mapBom(headers, [row("a", "b"), row("b", "a")], mapping).errors.some(
        (e) => e.message.includes("순환"),
      ),
    ).toBe(true);
    expect(
      mapBom(headers, [row("a", ""), row("a", "")], mapping).errors.some((e) =>
        e.message.includes("중복"),
      ),
    ).toBe(true);
    expect(
      mapBom(headers, [row("a", "missing", "0", "unknown", "")], mapping).errors
        .length,
    ).toBeGreaterThanOrEqual(4);
  });
  it("reads a real single-sheet XLSX with literal cell values", async () => {
    const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const entries: Record<string, Uint8Array> = {
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      "xl/workbook.xml": strToU8(
        `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BOM" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Part</t></is></c><c r="B1" t="inlineStr"><is><t>Qty</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>PSU-A</t></is></c><c r="B2"><v>2</v></c></row></sheetData></worksheet>`,
      ),
    };
    const input = await parseInput({
      content: Buffer.from(zipSync(entries)).toString("base64"),
      format: "xlsx",
    });
    expect(input).toEqual({
      headers: ["Part", "Qty"],
      values: [["PSU-A", "2"]],
    });
  });
  it("rejects duplicate headers, formulas/merged worksheets and escapes CSV formulas", async () => {
    await expect(
      parseInput({ content: "x,x\na,b", format: "csv" }),
    ).rejects.toThrow(/중복/);
    const archive = zipSync({
      "xl/worksheets/sheet1.xml": strToU8("<worksheet><f>1+1</f></worksheet>"),
    });
    await expect(
      parseInput({
        content: Buffer.from(archive).toString("base64"),
        format: "xlsx",
      }),
    ).rejects.toThrow(/수식/);
    expect(csvExport([["=1+1", "@SUM(A1)", "safe"]])).toContain('"\'=1+1"');
  });
  it("maps 10,000 occurrences within L5 and rejects a deeper chain without recursion overflow", () => {
    const mapping = defaultMappings[0],
      fields = Object.keys(mapping.columns);
    const values = Array.from({ length: 10000 }, (_, i) => [
      String(i),
      i ? String(Math.floor((i - 1) / 12)) : "",
      "PART",
      "R1",
      "품목",
      "1",
      "EA",
      "C1",
      "전원",
    ]);
    const result = mapBom(
      fields.map((f) => mapping.columns[f]),
      values,
      mapping,
    );
    expect(result.rows).toHaveLength(10000);
    expect(result.errors).toEqual([]);
    expect(indexBom(result.rows).maxLevel).toBe(5);
    values.forEach((row, i) => {
      row[1] = i ? String(i - 1) : "";
    });
    const deep = mapBom(
      fields.map((f) => mapping.columns[f]),
      values,
      mapping,
    );
    expect(deep.errors).toHaveLength(9995);
    expect(deep.errors[0]).toMatchObject({ row: 7, field: "parent" });
    expect(deep.errors[0].message).toContain("L6");
  });
  it("keeps occurrence paths and quantities correct for L5, repeated parts and unsorted input", () => {
    const rows = seedBom();
    rows.push({
      ...rows.find((n) => n.occurrence === "PSU-CTRL")!,
      occurrence: "PSU-CTRL-2",
      quantity: 3,
    });
    const index = indexBom(rows.reverse());
    expect(index.errors).toEqual([]);
    expect(index.maxLevel).toBe(5);
    expect(bomPath(index.nodes, "PSU-CTRL").map((n) => n.occurrence)).toEqual([
      "SYS",
      "PWR",
      "PWR-CAGE",
      "PSU-1",
      "PSU-CTRL",
    ]);
    const pathIds = new Set(
      bomPath(index.nodes, "PSU-CTRL").map((n) => n.occurrence),
    );
    expect(
      visibleBomNodes(index, new Set(), pathIds).map((n) => n.occurrence),
    ).toEqual(["SYS", "PWR", "PWR-CAGE", "PSU-1", "PSU-CTRL"]);
    expect(visibleBomNodes(index, new Set()).map((n) => n.occurrence)).toEqual([
      "SYS",
    ]);
    expect(
      visibleBomNodes(index, pathIds).some((n) => n.occurrence === "PSU-CTRL"),
    ).toBe(true);
    expect(index.nodes.get("PSU-CTRL")?.quantityPerRoot).toBe(2);
    expect(index.nodes.get("PSU-CTRL-2")?.quantityPerRoot).toBe(6);
    expect(index.nodes.get("MEM-DIE")?.quantityPerRoot).toBe(256);
    expect(
      searchBom(index.nodes, "pwr-ctrl")
        .map((n) => n.occurrence)
        .sort(),
    ).toEqual(["PSU-CTRL", "PSU-CTRL-2"]);
    expect(
      indexBom([{ ...rows[0], occurrence: "SELF", parent: "SELF" }]).errors[0]
        .message,
    ).toContain("순환");
  });
});
