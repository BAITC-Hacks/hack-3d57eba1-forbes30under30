import { z } from "zod";
import { reportSchema, type AgentReport } from "./schemas";

const explanationFactsSchema = z.object({
  selectedMeasures: z.array(z.object({ id: z.string() })),
  scoreRules: z.object({ weakestWeightPercent: z.number(), criticalThreshold: z.number() }),
});
const swapFactsSchema = z.object({
  ok: z.literal(true),
  tool: z.literal("suggest_swaps"),
  suggestions: z.array(z.object({ change: z.string(), delta: z.number().finite() })),
});
const eventFactsSchema = z.object({
  ok: z.literal(true),
  tool: z.literal("get_active_event"),
  event: z.object({ title: z.string() }),
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
  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const report = parsed.data;

  const numbers = new Set<number>();
  function collect(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) numbers.add(value);
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  outputs.forEach(collect);
  const swapFacts = outputs.map((output) => swapFactsSchema.safeParse(output))
    .find((result) => result.success);
  if (!swapFacts?.success) throw new Error("Для рекомендаций отсутствует успешный результат suggest_swaps.");
  const suggestions = swapFacts.data.suggestions;
  if (suggestions.length > 0 && report.recommendations.length === 0) {
    throw new Error("Добавь хотя бы одну рекомендацию из suggestions инструмента suggest_swaps.");
  }
  const usedChanges = new Set<string>();
  for (const recommendation of report.recommendations) {
    if (!suggestions.some((suggestion) => suggestion.change === recommendation.change
      && suggestion.delta === recommendation.expectedDelta)) {
      throw new Error("Рекомендация не подтверждена suggest_swaps: дословно скопируй change и соответствующую delta в expectedDelta. Если suggestions пуст, recommendations должен быть [].");
    }
    if (usedChanges.has(recommendation.change)) throw new Error("Не повторяй одну и ту же рекомендацию.");
    usedChanges.add(recommendation.change);
  }
  const texts = [report.summary, ...report.strengths, ...report.risks, ...report.tradeoffs,
    ...report.recommendations.flatMap((item) => [item.change, item.why])];
  const activeEvent = outputs.map((output) => eventFactsSchema.safeParse(output))
    .find((result) => result.success);
  if (activeEvent?.success && !texts.join(" ").includes(activeEvent.data.event.title)) {
    throw new Error(`Объясни активное событие «${activeEvent.data.event.title}» и реакцию выбранного набора на его последствия.`);
  }
  for (const text of texts) {
    // Ignore IDs such as M10, T1 and C2; recognise decimal commas and minus signs.
    const tokens = text.matchAll(/(?<![\p{L}\p{N}_])[-+−]?\d+(?:[.,]\d+)?/gu);
    for (const [token] of tokens) {
      const value = Number(token.replace(",", ".").replace("−", "-"));
      if (!numbers.has(value)) throw new Error(`Число ${token} отсутствует в результатах инструментов.`);
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
