import { z } from "zod";

export const scenarioDecisionSchema = z.object({
  measureId: z.string().min(1),
  districtId: z.string().min(1).optional(),
}).strict();

export const scenarioNameSchema = z.string().trim().min(1).max(100);

export const savedScenarioSchema = z.object({
  name: scenarioNameSchema,
  decisions: z.array(scenarioDecisionSchema).length(5),
  score: z.number().finite(),
  cost: z.number().finite().min(0).max(100),
  createdAt: z.string().datetime(),
}).strict();

export type SavedScenario = z.infer<typeof savedScenarioSchema>;
