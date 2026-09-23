import { districts, measures, type Decision } from "../../engine/data";
import type { ScoreOptions } from "../../engine/events";
import { suggestSwaps } from "../../engine/optimize";
import { validate } from "../../engine/validate";
import {
  decisionsInputSchema, displayNumbers, normalizeToolDecisions,
  sameDecisions, type ToolResult,
} from "./shared";

export const inputSchema = decisionsInputSchema;
export const description = "Перебирает допустимые замены одной меры исходного набора, считает их движком и возвращает до пяти улучшений. Вызывай только для исходных решений. Каждая suggestion содержит точный текст change, delta относительно исходного Score, newScore и cost. Для рекомендации дословно скопируй change и перенеси delta в expectedDelta; любые другие замены запрещены. Пустой suggestions означает, что подтверждённых улучшений заменой одной меры нет.";

function decisionLabel(decision: Decision): string {
  const measure = measures.find(({ id }) => id === decision.measureId)!;
  const place = decision.districtId === undefined ? "город"
    : districts.find(({ id }) => id === decision.districtId)!.name;
  return `${measure.id} «${measure.name}» (${place})`;
}

export function execute(args: unknown, originalDecisions: readonly Decision[], options: ScoreOptions = {}): ToolResult {
  const { decisions: wireDecisions } = inputSchema.parse(args);
  const decisions = normalizeToolDecisions(wireDecisions);
  const validation = validate(decisions);
  if (!validation.ok) {
    return { output: validation, summary: `Подбор замен отклонён: ${validation.errors.join(" ")}` };
  }
  if (!sameDecisions(decisions, originalDecisions)) {
    const error = "Подбор замен доступен только для исходного набора решений без изменений.";
    return { output: { ok: false, errors: [error] }, summary: error };
  }

  const suggestions = suggestSwaps(decisions, options).map((suggestion) => {
    const previous = decisions.find(({ measureId }) => measureId === suggestion.replace)!;
    const replacement: Decision = {
      measureId: suggestion.with,
      ...(suggestion.districtId === undefined ? {} : { districtId: suggestion.districtId }),
    };
    return {
      ...suggestion,
      change: `Заменить ${decisionLabel(previous)} на ${decisionLabel(replacement)}.`,
    };
  });
  return {
    output: displayNumbers({ ok: true, tool: "suggest_swaps", decisions, suggestions,
      ...(options.eventId === undefined ? {} : { eventId: options.eventId }),
    }),
    summary: suggestions.length === 0
      ? "Подтверждённых улучшений заменой одной меры не найдено."
      : `Найдено улучшений: ${suggestions.length}; лучший прирост Score +${suggestions[0].delta.toFixed(2)}.`,
  };
}
