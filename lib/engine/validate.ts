import {
  directions, districts, incompatibilities, measures, rules,
  type Direction, type Measure,
} from "./data";

export type ValidationResult = { ok: boolean; errors: string[] };
export type ResolvedDecision = { measure: Measure; districtId?: string };

// Score also uses this check, but accepts incomplete sets for marginal effects.
export function resolveDecisions(input: unknown): {
  decisions: ResolvedDecision[];
  errors: string[];
} {
  const decisions: ResolvedDecision[] = [];
  const errors: string[] = [];
  if (!Array.isArray(input)) {
    return { decisions, errors: ["Решения должны быть массивом мер."] };
  }

  const seen = new Set<string>();
  for (const [index, value] of (input as unknown[]).entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`Решение №${index + 1} должно быть объектом с measureId.`);
      continue;
    }
    const decision = value as Record<string, unknown>;
    if (typeof decision.measureId !== "string" || !decision.measureId) {
      errors.push(`Решение №${index + 1}: укажите идентификатор меры (measureId).`);
      continue;
    }
    const measure = measures.find((item) => item.id === decision.measureId);
    if (!measure) {
      errors.push(`Неизвестная мера: ${decision.measureId}.`);
      continue;
    }
    if (seen.has(measure.id) && rules.noRepeats) {
      errors.push(`Повтор меры ${measure.id} запрещён, даже в разных районах.`);
    }
    seen.add(measure.id);

    const districtId = decision.districtId;
    if (measure.scope === "city" && districtId !== undefined) {
      errors.push(`Городская мера ${measure.id} не должна иметь район.`);
    }
    if (measure.scope === "district") {
      if (typeof districtId !== "string" || districtId.length === 0) {
        errors.push(`Для районной меры ${measure.id} нужно указать район.`);
      } else if (!districts.some((district) => district.id === districtId)) {
        errors.push(`Неизвестный район «${districtId}» для меры ${measure.id}.`);
      }
    }
    decisions.push({
      measure,
      ...(typeof districtId === "string" ? { districtId } : {}),
    });
  }
  return { decisions, errors };
}

export function validate(input: unknown): ValidationResult {
  const { decisions, errors } = resolveDecisions(input);
  if (!Array.isArray(input)) return { ok: false, errors };

  if (input.length !== rules.decisionsExactly) {
    errors.push(`Нужно выбрать ровно ${rules.decisionsExactly} мер; выбрано ${input.length}.`);
  }
  const cost = decisions.reduce((total, decision) => total + decision.measure.cost, 0);
  if (cost > rules.budget) {
    errors.push(`Превышен бюджет: стоимость ${cost}, доступно ${rules.budget}.`);
  }

  const counts = new Map<Direction, number>();
  for (const { measure } of decisions) {
    counts.set(measure.direction, (counts.get(measure.direction) ?? 0) + 1);
  }
  for (const [direction, count] of counts) {
    if (count > rules.maxPerDirection) {
      errors.push(
        `Направление «${directions[direction]}»: выбрано ${count} мер, максимум ${rules.maxPerDirection}.`,
      );
    }
  }

  for (const { pair, sameDistrictOnly, reason } of incompatibilities) {
    const first = decisions.filter((decision) => decision.measure.id === pair[0]);
    const second = decisions.filter((decision) => decision.measure.id === pair[1]);
    const conflict = first.some((a) => second.some((b) => (
      !sameDistrictOnly || (
        a.districtId !== undefined && a.districtId === b.districtId
      )
    )));
    if (conflict) {
      errors.push(`Меры ${pair[0]} и ${pair[1]} несовместимы: ${reason}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}
