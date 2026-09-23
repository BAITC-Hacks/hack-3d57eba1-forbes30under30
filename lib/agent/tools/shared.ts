import { z } from "zod";
import {
  directions, districts, rules, type Decision, type Measure,
} from "../../engine/data";

export const toolDecisionSchema = z.object({
  measureId: z.string().min(1),
  districtId: z.string().min(1).nullable()
    .describe("Район для районной меры; null для городской меры."),
}).strict();

export const decisionsInputSchema = z.object({
  decisions: z.array(toolDecisionSchema).max(14),
}).strict();

export type ToolResult = { output: unknown; summary: string };

export function normalizeToolDecisions(
  decisions: readonly z.infer<typeof toolDecisionSchema>[],
): Decision[] {
  return decisions.map(({ measureId, districtId }) => ({
    measureId,
    ...(districtId === null ? {} : { districtId }),
  }));
}

export function measureFacts(measure: Measure, districtId?: string) {
  const realized = (rules.horizonQuarters - measure.lag) / rules.horizonQuarters;
  return {
    ...measure,
    directionName: directions[measure.direction],
    ...(districtId === undefined ? {} : {
      districtId,
      districtName: districts.find((district) => district.id === districtId)?.name,
    }),
    realizedPercent: realized * 100,
    realizedEffects: Object.fromEntries(Object.entries(measure.effects).map(
      ([code, value]) => [code, value * realized],
    )),
  };
}

// Only the tool's presentation is rounded. Engine calculations stay untouched.
export function displayNumbers(value: unknown): unknown {
  if (typeof value === "number") return Number(value.toFixed(2));
  if (Array.isArray(value)) return value.map(displayNumbers);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(
      ([key, child]) => [key, displayNumbers(child)],
    ));
  }
  return value;
}

export function sameDecisions(a: readonly Decision[], b: readonly Decision[]): boolean {
  return a.length === b.length && a.every((decision) => b.some((other) => (
    decision.measureId === other.measureId && decision.districtId === other.districtId
  )));
}
