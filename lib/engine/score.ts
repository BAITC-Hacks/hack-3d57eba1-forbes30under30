import {
  districts, indicators, rules, synergies,
  type Decision, type District, type IndicatorCode, type IndicatorValues,
} from "./data";
import { getStartingDistricts, type ScoreOptions } from "./events";
import { resolveDecisions, type ResolvedDecision } from "./validate";

export type DistrictScore = {
  id: string;
  name: string;
  before: IndicatorValues;
  after: IndicatorValues;
  D_before: number;
  D_after: number;
};
export type Critical = { districtId: string; indicator: IndicatorCode; value: number };
export type Contribution = Decision & { contribution: number };
export type AppliedSynergy = {
  pair: [string, string];
  indicator: IndicatorCode;
  bonus: number;
  districtIds: string[];
};
export type ScoreResult = {
  score: number;
  baseScore: number;
  delta: number;
  districts: DistrictScore[];
  dAvg: number;
  minDistrict: number;
  criticals: Critical[];
  contributions: Contribution[];
  synergiesApplied: AppliedSynergy[];
};

function districtScore(values: IndicatorValues): number {
  return indicators.reduce((total, indicator) => (
    total + indicator.weight * values[indicator.code]
  ), 0);
}

function calculate(decisions: readonly ResolvedDecision[], startingDistricts: readonly District[]) {
  const results: DistrictScore[] = startingDistricts.map((district) => ({
    id: district.id,
    name: district.name,
    before: { ...district.values },
    after: { ...district.values },
    D_before: districtScore(district.values),
    D_after: 0,
  }));
  const targetDistricts = (decision: ResolvedDecision) => results.filter((district) => (
    decision.measure.scope === "city" || district.id === decision.districtId
  ));

  for (const decision of decisions) {
    const realized = (rules.horizonQuarters - decision.measure.lag) / rules.horizonQuarters;
    for (const district of targetDistricts(decision)) {
      for (const { code } of indicators) {
        district.after[code] += (decision.measure.effects[code] ?? 0) * realized;
      }
    }
  }

  const synergiesApplied: AppliedSynergy[] = [];
  for (const synergy of synergies) {
    const first = decisions.find((decision) => decision.measure.id === synergy.pair[0]);
    const second = decisions.find((decision) => decision.measure.id === synergy.pair[1]);
    if (!first || !second) continue;

    const targets = targetDistricts(first);
    for (const district of targets) {
      district.after[synergy.indicator] += synergy.bonus;
    }
    synergiesApplied.push({
      pair: [...synergy.pair],
      indicator: synergy.indicator,
      bonus: synergy.bonus,
      districtIds: targets.map((district) => district.id),
    });
  }

  const criticals: Critical[] = [];
  let dAvg = 0;
  for (const [index, district] of results.entries()) {
    for (const { code } of indicators) {
      const value = Math.max(rules.clip[0], Math.min(rules.clip[1], district.after[code]));
      district.after[code] = value;
      if (value < rules.criticalThreshold) {
        criticals.push({ districtId: district.id, indicator: code, value });
      }
    }
    district.D_after = districtScore(district.after);
    dAvg += districts[index].population * district.D_after;
  }
  const minDistrict = Math.min(...results.map((district) => district.D_after));
  return {
    score: 0.7 * dAvg + 0.3 * minDistrict - criticals.length,
    districts: results,
    dAvg,
    minDistrict,
    criticals,
    synergiesApplied,
  };
}

// Incomplete sets are intentional: score([]) gives the baseline and removing
// one measure gives its marginal contribution. Validate a full set separately.
export function score(input: readonly Decision[], options: ScoreOptions = {}): ScoreResult {
  const { decisions, errors } = resolveDecisions(input);
  if (errors.length > 0) {
    throw new Error(`Невозможно рассчитать Score: ${errors.join(" ")}`);
  }
  const startingDistricts = getStartingDistricts(options);
  const result = calculate(decisions, startingDistricts);
  const baseScore = calculate([], startingDistricts).score;
  const contributions = decisions.map((decision, index): Contribution => ({
    measureId: decision.measure.id,
    ...(decision.districtId === undefined ? {} : { districtId: decision.districtId }),
    contribution: result.score - calculate(decisions.filter((_, other) => other !== index), startingDistricts).score,
  }));

  return { ...result, baseScore, delta: result.score - baseScore, contributions };
}
