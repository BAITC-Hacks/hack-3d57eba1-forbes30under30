import { z } from "zod";
import { districts, indicators, measures, rules, type Decision } from "../../engine/data";
import { getEvent, type ScoreOptions } from "../../engine/events";
import { score } from "../../engine/score";
import { displayNumbers, measureFacts, type ToolResult } from "./shared";

export const inputSchema = z.object({}).strict();
export const description = "Возвращает активное неожиданное событие, его последствия для исходных показателей, Score того же набора до и после события, пострадавшие районы и прямые эффекты выбранных мер на затронутые показатели. Событие и исходный набор зафиксированы сервером; аргументы — пустой объект. Оцени, отвечает ли набор на событие. Рекомендации бери только из suggest_swaps, который уже учитывает это же событие.";

export function execute(args: unknown, decisions: readonly Decision[], options: ScoreOptions = {}): ToolResult {
  inputSchema.parse(args);
  const event = getEvent(options.eventId);
  if (!event) {
    return { output: { ok: true, tool: "get_active_event", event: null }, summary: "Неожиданное событие не активно." };
  }
  const beforeEvent = score(decisions);
  const afterEvent = score(decisions, options);
  const affectedDistricts = Object.entries(event.effects).map(([districtId, effects]) => {
    const district = districts.find(({ id }) => id === districtId)!;
    const result = afterEvent.districts.find(({ id }) => id === districtId)!;
    const previous = beforeEvent.districts.find(({ id }) => id === districtId)!;
    const affectedIndicators = indicators.filter(({ code }) => effects[code] !== undefined);
    const directMeasureResponses = decisions.flatMap((decision) => {
      const measure = measures.find(({ id }) => id === decision.measureId)!;
      if (measure.scope === "district" && decision.districtId !== districtId) return [];
      const facts = measureFacts(measure, decision.districtId);
      const responseEffects = affectedIndicators.flatMap(({ code }) => {
        const delta = facts.realizedEffects[code];
        return delta === undefined || delta === 0 ? [] : [{ indicator: code, realizedDelta: delta }];
      });
      return responseEffects.length === 0 ? [] : [{
        measureId: measure.id, name: measure.name, cost: measure.cost,
        lag: measure.lag, realizedPercent: facts.realizedPercent, effects: responseEffects,
      }];
    });
    return {
      id: districtId,
      name: district.name,
      D_beforeEvent: previous.D_before,
      D_afterEvent: result.D_before,
      D_afterMeasures: result.D_after,
      indicators: affectedIndicators.map(({ code, name }) => ({
        code, name, eventDelta: effects[code],
        beforeEvent: district.values[code],
        afterEvent: result.before[code],
        afterMeasures: result.after[code],
        criticalAfterMeasures: result.after[code] < rules.criticalThreshold,
      })),
      directMeasureResponses,
      synergiesApplied: afterEvent.synergiesApplied.filter((synergy) => (
        synergy.districtIds.includes(districtId) && effects[synergy.indicator] !== undefined
      )),
    };
  });
  return {
    output: displayNumbers({
      ok: true, tool: "get_active_event", event,
      scoreBeforeEvent: beforeEvent.score,
      scoreAfterEvent: afterEvent.score,
      eventScoreChange: afterEvent.score - beforeEvent.score,
      baseScoreWithEvent: afterEvent.baseScore,
      criticalThreshold: rules.criticalThreshold,
      affectedDistricts,
      note: "Событие применяется к исходным показателям с clip до эффектов мер. directMeasureResponses показывает прямые эффекты выбранных мер до финального clip; итоговые значения и синергии указаны отдельно. Пустой список означает, что выбранные меры напрямую не воздействуют на затронутые показатели этого района. Замены проверены отдельно в suggest_swaps с тем же событием.",
    }),
    summary: `${event.title}: Score набора ${beforeEvent.score.toFixed(2)} → ${afterEvent.score.toFixed(2)}; пострадавшие районы: ${affectedDistricts.map(({ name }) => name).join(", ")}.`,
  };
}
