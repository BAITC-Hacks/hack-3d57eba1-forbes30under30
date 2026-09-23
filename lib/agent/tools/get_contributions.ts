import { measures } from "../../engine/data";
import type { ScoreOptions } from "../../engine/events";
import { score } from "../../engine/score";
import { validate } from "../../engine/validate";
import { formatScoreDelta } from "../../format";
import {
  decisionsInputSchema, displayNumbers, measureFacts, normalizeToolDecisions,
  type ToolResult,
} from "./shared";

export const inputSchema = decisionsInputSchema;
export const description = "Возвращает рассчитанный движком вклад каждой меры: Score полного набора минус Score без этой меры. Добавляет название, район, стоимость, лаг и реализованную долю эффекта. Вклады учитывают синергии и штрафы, поэтому их нельзя суммировать для получения дельты сценария.";

export function execute(args: unknown, options: ScoreOptions = {}): ToolResult {
  const { decisions: wireDecisions } = inputSchema.parse(args);
  const decisions = normalizeToolDecisions(wireDecisions);
  const validation = validate(decisions);
  if (!validation.ok) {
    return { output: validation, summary: `Вклады не рассчитаны: ${validation.errors.join(" ")}` };
  }
  const calc = score(decisions, options);
  const contributions = calc.contributions.map((contribution) => ({
    ...measureFacts(measures.find((measure) => measure.id === contribution.measureId)!, contribution.districtId),
    ...contribution,
  }));
  return {
    output: displayNumbers({
      ok: true,
      ...(options.eventId === undefined ? {} : { eventId: options.eventId }),
      score: calc.score,
      delta: calc.delta,
      contributions,
      note: "Вклад — разница Score с мерой и без неё. Вклады не аддитивны из-за синергий, минимума районов и критических порогов.",
    }),
    summary: contributions.map((item) => `${item.measureId}: ${formatScoreDelta(item.contribution)}`).join("; "),
  };
}
