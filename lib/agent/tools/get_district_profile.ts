import { z } from "zod";
import { districts, indicators, rules } from "../../engine/data";
import type { ScoreOptions } from "../../engine/events";
import { score } from "../../engine/score";
import { validate } from "../../engine/validate";
import { formatScore } from "../../format";
import {
  decisionsInputSchema, displayNumbers, normalizeToolDecisions, type ToolResult,
} from "./shared";

export const inputSchema = decisionsInputSchema.extend({ districtId: z.string().min(1) }).strict();
export const description = "Показывает профиль выбранного района, долю населения, индекс района и каждый показатель до и после сценария; отмечает критические показатели ниже порога. Расчёт выполняется движком для переданного полного набора.";

export function execute(args: unknown, options: ScoreOptions = {}): ToolResult {
  const { districtId, decisions: wireDecisions } = inputSchema.parse(args);
  const decisions = normalizeToolDecisions(wireDecisions);
  const validation = validate(decisions);
  if (!validation.ok) {
    return { output: validation, summary: `Профиль не рассчитан: ${validation.errors.join(" ")}` };
  }
  const district = districts.find((item) => item.id === districtId);
  if (!district) {
    const error = `Неизвестный район «${districtId}».`;
    return { output: { ok: false, errors: [error] }, summary: error };
  }
  const calc = score(decisions, options);
  const result = calc.districts.find((item) => item.id === districtId)!;
  return {
    output: displayNumbers({
      ok: true,
      ...(options.eventId === undefined ? {} : { eventId: options.eventId }),
      id: district.id,
      name: district.name,
      profile: district.profile,
      population: district.population,
      populationPercent: district.population * 100,
      D_before: result.D_before,
      D_after: result.D_after,
      D_delta: result.D_after - result.D_before,
      criticalThreshold: rules.criticalThreshold,
      indicators: indicators.map((indicator) => ({
        ...indicator,
        before: result.before[indicator.code],
        after: result.after[indicator.code],
        delta: result.after[indicator.code] - result.before[indicator.code],
        critical: result.after[indicator.code] < rules.criticalThreshold,
      })),
      criticals: calc.criticals.filter((item) => item.districtId === district.id),
      weakest: result.D_after === calc.minDistrict,
    }),
    summary: `${district.name}: индекс ${formatScore(result.D_before)} → ${formatScore(result.D_after)}; критических показателей: ${calc.criticals.filter((item) => item.districtId === district.id).length}.`,
  };
}
