import { districts, measures, type Decision } from "./engine/data";
import type { SwapSuggestion } from "./engine/optimize";
import type { Suggestion } from "./result-schema";

function label(decision: Decision): string {
  const measure = measures.find(({ id }) => id === decision.measureId)!;
  const place = decision.districtId === undefined ? "город"
    : districts.find(({ id }) => id === decision.districtId)!.name;
  return `${measure.id} «${measure.name}» (${place})`;
}

// Use the agent tool's canonical wording so a button can match both the exact
// replacement and its verified delta, rather than guessing from model prose.
export function describeSuggestion(suggestion: SwapSuggestion, decisions: readonly Decision[]): Suggestion {
  const previous = decisions.find(({ measureId }) => measureId === suggestion.replace)!;
  return {
    ...suggestion,
    change: `Заменить ${label(previous)} на ${label({ measureId: suggestion.with, districtId: suggestion.districtId })}.`,
  };
}

export function applySuggestion(decisions: readonly Decision[], suggestion: Suggestion): Decision[] {
  return decisions.map((decision) => decision.measureId === suggestion.replace
    ? { measureId: suggestion.with, ...(suggestion.districtId === undefined ? {} : { districtId: suggestion.districtId }) }
    : { ...decision });
}
