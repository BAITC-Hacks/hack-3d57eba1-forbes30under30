import { measures, rules } from "../../engine/data";
import { validate } from "../../engine/validate";
import { formatNumber } from "../../format";
import {
  decisionsInputSchema, normalizeToolDecisions, type ToolResult,
} from "./shared";

export const inputSchema = decisionsInputSchema;
export const description = "Проверяет набор по правилам движка: ровно пять мер, бюджет, районы, повторы, направления и несовместимости. Возвращает причины ошибок на русском. Для городских мер districtId должен быть null.";

export function execute(args: unknown): ToolResult {
  const { decisions: wireDecisions } = inputSchema.parse(args);
  const decisions = normalizeToolDecisions(wireDecisions);
  const result = validate(decisions);
  const cost = decisions.reduce((total, decision) => (
    total + (measures.find((measure) => measure.id === decision.measureId)?.cost ?? 0)
  ), 0);
  return {
    output: { ...result, decisions, cost, budget: rules.budget },
    summary: result.ok
      ? `Набор допустим; стоимость ${formatNumber(cost)} из ${formatNumber(rules.budget)}.`
      : `Набор недопустим: ${result.errors.join(" ")}`,
  };
}
