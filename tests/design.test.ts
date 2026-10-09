import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps DESIGN.md token values in sync with the single application palette", () => {
  const doc = readFileSync(new URL("../DESIGN.md", import.meta.url), "utf8");
  const css = readFileSync(
    new URL("../src/index.css", import.meta.url),
    "utf8",
  );
  const roots = [...css.matchAll(/:root\s*\{([^}]+)\}/g)];
  expect(roots).toHaveLength(1);
  const values = new Map(
    [...roots[0][1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]),
  );
  const documented = [
    ...doc.matchAll(/\|\s*`(--[\w-]+)`\s*\|\s*`([^`]+)`\s*\|/g),
  ];
  expect(documented.length).toBeGreaterThan(40);
  for (const [, token, value] of documented)
    expect(values.get(token), token).toBe(value);
});
