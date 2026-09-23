import {
  directions, districts, indicators, incompatibilities, measures, rules, synergies,
  type Decision,
} from "../../engine/data";
import { score } from "../../engine/score";
import type { ScoreOptions } from "../../engine/events";
import { validate } from "../../engine/validate";
import {
  decisionsInputSchema, displayNumbers, measureFacts, normalizeToolDecisions,
  sameDecisions, type ToolResult,
} from "./shared";

export const inputSchema = decisionsInputSchema;
export const description = "Проверяет и рассчитывает полный набор через движок. Возвращает Score, дельту к базе, показатели районов, критические значения, штраф, синергии, лаги, стоимость и каталог мер. Для другого допустимого набора возвращает comparison.expectedDelta относительно исходного сценария. Рекомендации разрешены только из suggest_swaps; comparison не добавляет допустимых замен. Недопустимые наборы не рассчитываются.";

export function execute(args: unknown, originalDecisions: readonly Decision[], options: ScoreOptions = {}): ToolResult {
  const { decisions: wireDecisions } = inputSchema.parse(args);
  const decisions = normalizeToolDecisions(wireDecisions);
  const validation = validate(decisions);
  if (!validation.ok) {
    return {
      output: validation,
      summary: `Расчёт отклонён: ${validation.errors.join(" ")}`,
    };
  }

  const calc = score(decisions, options);
  const baseline = score([], options);
  const selectedMeasures = decisions.map((decision) => {
    const measure = measures.find((item) => item.id === decision.measureId)!;
    return measureFacts(measure, decision.districtId);
  });
  const cost = selectedMeasures.reduce((total, measure) => total + measure.cost, 0);
  const weakestDistrict = calc.districts.reduce((weakest, district) => (
    district.D_after < weakest.D_after ? district : weakest
  ));
  const synergiesMissed = synergies.filter((synergy) => (
    !synergy.pair.every((id) => decisions.some((decision) => decision.measureId === id))
  )).map((synergy) => ({
    ...synergy,
    missingMeasureIds: synergy.pair.filter((id) => (
      !decisions.some((decision) => decision.measureId === id)
    )),
  }));
  const comparison = sameDecisions(decisions, originalDecisions) ? undefined : {
    expectedDelta: calc.score - score(originalDecisions, options).score,
    decisions,
  };

  return {
    output: displayNumbers({
      ok: true,
      decisions,
      calc,
      ...(options.eventId === undefined ? {} : { eventId: options.eventId }),
      budget: { limit: rules.budget, cost, remaining: rules.budget - cost },
      weakestDistrict: {
        id: weakestDistrict.id, name: weakestDistrict.name, D: weakestDistrict.D_after,
      },
      criticalCount: calc.criticals.length,
      criticalPenalty: calc.criticals.length,
      baselineCriticalCount: baseline.criticals.length,
      baselineCriticals: baseline.criticals,
      scoreRules: {
        averageWeightPercent: 70,
        weakestWeightPercent: 30,
        penaltyPerCritical: 1,
        criticalThreshold: rules.criticalThreshold,
        horizonQuarters: rules.horizonQuarters,
        formula: rules.score,
        decisionsExactly: rules.decisionsExactly,
        maxPerDirection: rules.maxPerDirection,
      },
      selectedMeasures,
      untouchedDirections: Object.entries(directions)
        .filter(([id]) => !selectedMeasures.some((measure) => measure.direction === id))
        .map(([id, name]) => ({ id, name })),
      synergiesMissed,
      synergyRules: synergies,
      incompatibilities,
      measureCatalog: measures.map((measure) => measureFacts(measure)),
      districtCatalog: districts.map(({ id, name, population, profile }) => ({
        id, name, populationPercent: population * 100, profile,
      })),
      indicators,
      ...(comparison === undefined ? {} : { comparison }),
    }),
    summary: `Score ${calc.score.toFixed(2)}, дельта к базе ${calc.delta.toFixed(2)}, стоимость ${cost}; критических значений: ${calc.criticals.length}.`,
  };
}
