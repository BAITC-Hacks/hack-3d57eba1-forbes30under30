import { z } from "zod";
import { agentStepSchema, reportSchema } from "./agent/schemas";

const decisionSchema = z.object({ measureId: z.string(), districtId: z.string().optional() });
const number = z.number().finite();
const indicatorSchema = z.enum(["T1", "T2", "E1", "E2", "S1", "S2", "B1", "B2", "C1", "C2"]);
const valuesSchema = z.record(indicatorSchema, number);
export const suggestionSchema = z.object({
  replace: z.string(), with: z.string(), districtId: z.string().optional(),
  newScore: number, delta: number, cost: number, change: z.string(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const analysisSchema = z.object({
  calc: z.object({
    score: number, baseScore: number, delta: number, dAvg: number, minDistrict: number,
    districts: z.array(z.object({
      id: z.string(), name: z.string(), before: valuesSchema, after: valuesSchema,
      D_before: number, D_after: number,
    })).length(5),
    criticals: z.array(z.object({ districtId: z.string(), indicator: indicatorSchema, value: number })),
    contributions: z.array(decisionSchema.extend({ contribution: number })),
    synergiesApplied: z.array(z.object({
      pair: z.tuple([z.string(), z.string()]), indicator: indicatorSchema,
      bonus: number, districtIds: z.array(z.string()),
    })),
  }),
  cost: number,
  suggestions: z.array(suggestionSchema),
  bestKnownScore: number,
  optimalDecisions: z.array(decisionSchema).length(5),
  report: reportSchema.nullable(),
  steps: z.array(agentStepSchema),
  aiError: z.string().optional(),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const apiErrorSchema = z.object({ error: z.string().optional(), errors: z.array(z.string()).optional() });
