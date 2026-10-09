import { describe, expect, it } from "vitest";
import { seedBom } from "../src/server/seed";
import { bomPath, indexBom } from "../src/shared/bom";
import { layoutBomTopology } from "../src/lib/bom-topology";

describe("BOM containment layout", () => {
  it("keeps every child inside its real parent and siblings apart without changing BOM data", () => {
    const rows = seedBom().reverse(),
      before = structuredClone(rows);
    rows.push({
      ...rows.find((n) => n.occurrence === "PSU-CTRL")!,
      occurrence: "CTRL-2",
    });
    const index = indexBom(rows),
      expanded = new Set(index.nodes.keys());
    const { boxes, omitted } = layoutBomTopology(index, expanded);
    expect(omitted).toBe(0);
    expect(boxes).toHaveLength(rows.length);
    const seen = new Map<string, (typeof boxes)[number]>();
    for (const box of boxes) {
      if (box.parentId) {
        const parent = seen.get(box.parentId)!;
        expect(parent).toBeDefined();
        expect(box.position.x).toBeGreaterThanOrEqual(0);
        expect(box.position.y).toBeGreaterThanOrEqual(44);
        expect(box.position.x + box.width).toBeLessThanOrEqual(parent.width);
        expect(box.position.y + box.height).toBeLessThanOrEqual(parent.height);
      }
      for (const other of seen.values()) {
        if (other.parentId !== box.parentId) continue;
        const separated =
          box.position.x + box.width <= other.position.x ||
          other.position.x + other.width <= box.position.x ||
          box.position.y + box.height <= other.position.y ||
          other.position.y + other.height <= box.position.y;
        expect(separated).toBe(true);
      }
      seen.set(box.id, box);
    }
    expect(seen.has("CTRL-2") && seen.has("PSU-CTRL")).toBe(true);
    expect(rows.slice(0, -1)).toEqual(before);
  });
  it("respects collapse and depth while reserving a selected path under the canvas limit", () => {
    const index = indexBom(seedBom()),
      expanded = new Set(index.nodes.keys());
    const short = layoutBomTopology(index, expanded, 5, "PSU-CTRL", 10);
    expect(short.boxes).toHaveLength(10);
    expect(short.omitted).toBe(index.nodes.size - 10);
    for (const n of bomPath(index.nodes, "PSU-CTRL"))
      expect(short.boxes.some((b) => b.id === n.occurrence)).toBe(true);
    for (const b of short.boxes)
      if (b.parentId)
        expect(short.boxes.some((p) => p.id === b.parentId)).toBe(true);
    expanded.delete("PWR");
    expect(
      layoutBomTopology(index, expanded, 5, "PSU-CTRL").boxes.some(
        (n) => n.id === "PSU-CTRL",
      ),
    ).toBe(false);
    expect(
      layoutBomTopology(index, new Set(index.nodes.keys()), 2).boxes.every(
        (b) => index.nodes.get(b.id)!.level <= 2,
      ),
    ).toBe(true);
  });
});
