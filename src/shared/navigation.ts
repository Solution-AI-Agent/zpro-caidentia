import { z } from "zod";

// Agent/UI state is limited to navigation; it cannot carry business-state patches.
export const navigationSchema = z
  .object({
    actorId: z.string(),
    sourceVersion: z.number().int().positive(),
    supplier: z.enum(["A", "B"]),
    tab: z.literal("map"),
    panel: z.enum(["review", "discussion", "files"]),
  })
  .strict();
export type Navigation = z.infer<typeof navigationSchema>;
export type InspectorPanel = Navigation["panel"];
