import { z } from "zod";
import { reportSchema, reportWireSchema, type AgentReport } from "./schemas";

const explanationFactsSchema = z.object({
  selectedMeasures: z.array(z.object({ id: z.string() })),
  scoreRules: z.object({ weakestWeightPercent: z.number(), criticalThreshold: z.number() }),
});

// A numeric claim must occur in a tool result; this catches invented arithmetic
// in prose as well as unsupported forecasts in structured recommendations.
export function validateReport(content: string, outputs: readonly unknown[]): AgentReport {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new Error("Ожидался корректный JSON без markdown.");
  }
  const parsed = reportWireSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const report = reportSchema.parse({
    ...parsed.data,
    recommendations: parsed.data.recommendations.map(({ expectedDelta, ...recommendation }) => ({
      ...recommendation,
      ...(expectedDelta === null ? {} : { expectedDelta }),
    })),
  });

  const numbers = new Set<number>();
  const verifiedDeltas = new Set<number>();
  function collect(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) numbers.add(value);
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  for (const output of outputs) {
    collect(output);
    if (output && typeof output === "object" && "comparison" in output) {
      const comparison = output.comparison;
      if (comparison && typeof comparison === "object" && "expectedDelta" in comparison
        && typeof comparison.expectedDelta === "number") {
        verifiedDeltas.add(comparison.expectedDelta);
      }
    }
  }
  const texts = [report.summary, ...report.strengths, ...report.risks, ...report.tradeoffs,
    ...report.recommendations.flatMap((item) => [item.change, item.why])];
  for (const text of texts) {
    // Ignore IDs such as M10, T1 and C2; recognise decimal commas and minus signs.
    const tokens = text.matchAll(/(?<![\p{L}\p{N}_])[-+−]?\d+(?:[.,]\d+)?/gu);
    for (const [token] of tokens) {
      const value = Number(token.replace(",", ".").replace("−", "-"));
      if (!numbers.has(value)) throw new Error(`Число ${token} отсутствует в результатах инструментов.`);
    }
  }
  for (const recommendation of report.recommendations) {
    if (recommendation.expectedDelta !== undefined && !verifiedDeltas.has(recommendation.expectedDelta)) {
      throw new Error("expectedDelta не подтверждён сравнением альтернативы в score_set.");
    }
  }
  const facts = explanationFactsSchema.safeParse(outputs[0]);
  if (facts.success) {
    const text = texts.join(" ");
    for (const { id } of facts.data.selectedMeasures) {
      if (!new RegExp(`\\b${id}\\b`).test(text)) throw new Error(`В отчёте отсутствует объяснение выбранной меры ${id}.`);
    }
    const { weakestWeightPercent, criticalThreshold } = facts.data.scoreRules;
    if (!new RegExp(`${weakestWeightPercent}\\s*(?:%|процент)`, "i").test(text)) {
      throw new Error(`Объясни вес самого слабого района ${weakestWeightPercent}% в формуле.`);
    }
    if (!new RegExp(`\\b${criticalThreshold}\\b`).test(text)) {
      throw new Error(`Объясни критический порог ${criticalThreshold} и штраф за каждую пару район–показатель.`);
    }
  }
  return report;
}
