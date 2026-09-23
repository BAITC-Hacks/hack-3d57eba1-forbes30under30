import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { z } from "zod";
import {
  districts, districtsData, indicators, incompatibilities, measures,
  measuresData, rules, synergies, type Decision,
} from "./data";
import { score } from "./score";
import { validate } from "./validate";

export type SwapSuggestion = {
  replace: string;
  with: string;
  districtId?: string;
  newScore: number;
  delta: number;
  cost: number;
};
export type BestSet = { decisions: Decision[]; score: number; cost: number };

const measureById = new Map(measures.map((measure) => [measure.id, measure]));

export function suggestSwaps(decisions: readonly Decision[]): SwapSuggestion[] {
  const validation = validate(decisions);
  if (!validation.ok) {
    throw new Error(`Невозможно подобрать замены: ${validation.errors.join(" ")}`);
  }
  const originalScore = score(decisions).score;
  const selected = new Set(decisions.map((decision) => decision.measureId));
  const suggestions: SwapSuggestion[] = [];

  for (let position = 0; position < decisions.length; position += 1) {
    for (const measure of measures) {
      if (selected.has(measure.id)) continue;
      const targets = measure.scope === "city" ? [undefined] : districts.map(({ id }) => id);
      for (const districtId of targets) {
        const replacement: Decision = {
          measureId: measure.id,
          ...(districtId === undefined ? {} : { districtId }),
        };
        const candidate = decisions.map((decision, index) => (
          index === position ? replacement : decision
        ));
        if (!validate(candidate).ok) continue;
        const newScore = score(candidate).score;
        const delta = newScore - originalScore;
        if (delta <= 0) continue;
        suggestions.push({
          replace: decisions[position].measureId,
          with: measure.id,
          ...(districtId === undefined ? {} : { districtId }),
          newScore,
          delta,
          cost: candidate.reduce((sum, decision) => sum + measureById.get(decision.measureId)!.cost, 0),
        });
      }
    }
  }
  // Stable sort retains the deterministic position / catalogue / district order on ties.
  return suggestions.sort((a, b) => b.delta - a.delta).slice(0, 5);
}

const cacheVersion = 1;
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ cacheVersion, districtsData, measuresData }))
  .digest("hex");
const bestSetSchema = z.object({
  decisions: z.array(z.object({
    measureId: z.string(), districtId: z.string().optional(),
  }).strict()).length(rules.decisionsExactly),
  score: z.number().finite(),
  cost: z.number().finite(),
}).strict();
const cacheSchema = z.object({
  version: z.literal(cacheVersion),
  fingerprint: z.literal(fingerprint),
  sets: z.array(bestSetSchema).length(10),
}).strict();

async function readCache(path: string): Promise<BestSet[] | null> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Не удалось прочитать кэш лучших наборов data/best.json.");
  }
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(contents));
    if (!parsed.success) return null;
    const seen = new Set<string>();
    for (let index = 0; index < parsed.data.sets.length; index += 1) {
      const entry = parsed.data.sets[index];
      if (!validate(entry.decisions).ok) return null;
      const key = entry.decisions.map(({ measureId, districtId }) => `${measureId}@${districtId ?? ""}`)
        .sort().join("|");
      if (seen.has(key)) return null;
      seen.add(key);
      const actualCost = entry.decisions.reduce((sum, decision) => sum + measureById.get(decision.measureId)!.cost, 0);
      if (entry.cost !== actualCost || Math.abs(entry.score - score(entry.decisions).score) > 1e-9) return null;
      if (index > 0 && entry.score > parsed.data.sets[index - 1].score) return null;
    }
    return parsed.data.sets;
  } catch {
    // A truncated or outdated cache must not prevent a fresh exhaustive search.
    return null;
  }
}

async function writeCache(path: string, sets: BestSet[]): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify({ version: cacheVersion, fingerprint, sets }, null, 2) + "\n", "utf8");
    await rename(temporary, path);
  } catch {
    await unlink(temporary).catch(() => undefined);
    throw new Error("Лучшие наборы рассчитаны, но не удалось сохранить кэш data/best.json.");
  }
}

async function enumerateBest(): Promise<BestSet[]> {
  const districtCount = districts.length;
  const indicatorCount = indicators.length;
  const measureCount = measures.length;
  const setSize = rules.decisionsExactly;
  const cellCount = districtCount * indicatorCount;
  const weights = Float64Array.from(indicators, ({ weight }) => weight);
  const populations = Float64Array.from(districts, ({ population }) => population);
  const initial = Float64Array.from(districts.flatMap((district) => (
    indicators.map(({ code }) => district.values[code])
  )));
  const effects = measures.map((measure) => Float64Array.from(indicators, ({ code }) => (
    (measure.effects[code] ?? 0) * (rules.horizonQuarters - measure.lag) / rules.horizonQuarters
  )));
  const directions = [...new Set(measures.map(({ direction }) => direction))];
  const directionIndices = Int16Array.from(measures, ({ direction }) => directions.indexOf(direction));
  const measureIndices = new Map(measures.map(({ id }, index) => [id, index]));
  const globalConflicts = new Uint8Array(measureCount * measureCount);
  const districtConflicts = new Uint8Array(measureCount * measureCount);
  for (const conflict of incompatibilities) {
    const first = measureIndices.get(conflict.pair[0])!;
    const second = measureIndices.get(conflict.pair[1])!;
    const matrix = conflict.sameDistrictOnly ? districtConflicts : globalConflicts;
    matrix[first * measureCount + second] = 1;
    matrix[second * measureCount + first] = 1;
  }
  const synergyIndices = synergies.map((synergy) => ({
    first: measureIndices.get(synergy.pair[0])!,
    second: measureIndices.get(synergy.pair[1])!,
    indicator: indicators.findIndex(({ code }) => code === synergy.indicator),
    bonus: synergy.bonus,
  }));

  // Choose distinct measures first. Budget, direction and global conflicts prune
  // the combination tree before any of its district assignments are considered.
  const combinations: { indices: number[]; cost: number }[] = [];
  const chosen = new Int16Array(setSize);
  const directionCounts = new Uint8Array(directions.length);
  function choose(depth: number, start: number, cost: number): void {
    if (depth === setSize) {
      combinations.push({ indices: Array.from(chosen), cost });
      return;
    }
    for (let index = start; index <= measureCount - (setSize - depth); index += 1) {
      const nextCost = cost + measures[index].cost;
      const direction = directionIndices[index];
      if (nextCost > rules.budget || directionCounts[direction] >= rules.maxPerDirection) continue;
      let compatible = true;
      for (let prior = 0; prior < depth; prior += 1) {
        if (globalConflicts[index * measureCount + chosen[prior]]) compatible = false;
      }
      if (!compatible) continue;
      chosen[depth] = index;
      directionCounts[direction] += 1;
      choose(depth + 1, index + 1, nextCost);
      directionCounts[direction] -= 1;
    }
  }
  choose(0, 0, 0);

  const topScores = new Float64Array(10).fill(-Infinity);
  const topCosts = new Float64Array(10);
  const topMeasures = new Int16Array(10 * setSize);
  const topDistricts = new Int16Array(10 * setSize);
  const values = new Float64Array(cellCount);
  const assignment = new Int16Array(setSize);
  let visited = 0;
  let topCount = 0;

  for (const combination of combinations) {
    const indices = combination.indices;
    const base = initial.slice();
    const combinedEffects = indices.map((index) => effects[index].slice());
    for (const synergy of synergyIndices) {
      const first = indices.indexOf(synergy.first);
      if (first >= 0 && indices.includes(synergy.second)) {
        combinedEffects[first][synergy.indicator] += synergy.bonus;
      }
    }
    const localPositions: number[] = [];
    const localEffects: { indicator: number[]; amount: number[] }[] = [];
    const conflictingPositions: number[] = [];
    for (let position = 0; position < setSize; position += 1) {
      if (measures[indices[position]].scope === "city") {
        assignment[position] = -1;
        for (let district = 0; district < districtCount; district += 1) {
          for (let indicator = 0; indicator < indicatorCount; indicator += 1) {
            base[district * indicatorCount + indicator] += combinedEffects[position][indicator];
          }
        }
      } else {
        assignment[position] = 0;
        localPositions.push(position);
        const sparse = { indicator: [] as number[], amount: [] as number[] };
        for (let indicator = 0; indicator < indicatorCount; indicator += 1) {
          if (combinedEffects[position][indicator] === 0) continue;
          sparse.indicator.push(indicator);
          sparse.amount.push(combinedEffects[position][indicator]);
        }
        localEffects.push(sparse);
        for (let prior = 0; prior < position; prior += 1) {
          if (districtConflicts[indices[position] * measureCount + indices[prior]]) {
            conflictingPositions.push(position, prior);
          }
        }
      }
    }

    let hasNext = true;
    while (hasNext) {
      let compatible = true;
      for (let pair = 0; pair < conflictingPositions.length; pair += 2) {
        if (assignment[conflictingPositions[pair]] === assignment[conflictingPositions[pair + 1]]) {
          compatible = false;
          break;
        }
      }
      if (compatible) {
        // Reuse numeric buffers throughout the hot loop: no Decision objects,
        // result arrays, contribution calculations or allocations per candidate.
        values.set(base);
        for (let local = 0; local < localPositions.length; local += 1) {
          const offset = assignment[localPositions[local]] * indicatorCount;
          const sparse = localEffects[local];
          for (let effect = 0; effect < sparse.indicator.length; effect += 1) {
            values[offset + sparse.indicator[effect]] += sparse.amount[effect];
          }
        }
        let average = 0;
        let minimum = Infinity;
        let criticals = 0;
        for (let district = 0; district < districtCount; district += 1) {
          let districtScore = 0;
          const offset = district * indicatorCount;
          for (let indicator = 0; indicator < indicatorCount; indicator += 1) {
            const value = Math.max(rules.clip[0], Math.min(rules.clip[1], values[offset + indicator]));
            if (value < rules.criticalThreshold) criticals += 1;
            districtScore += weights[indicator] * value;
          }
          average += populations[district] * districtScore;
          if (districtScore < minimum) minimum = districtScore;
        }
        const candidateScore = 0.7 * average + 0.3 * minimum - criticals;
        if (candidateScore > topScores[9]) {
          let rank = Math.min(topCount, 9);
          while (rank > 0 && candidateScore > topScores[rank - 1]) {
            topScores[rank] = topScores[rank - 1];
            topCosts[rank] = topCosts[rank - 1];
            for (let position = 0; position < setSize; position += 1) {
              topMeasures[rank * setSize + position] = topMeasures[(rank - 1) * setSize + position];
              topDistricts[rank * setSize + position] = topDistricts[(rank - 1) * setSize + position];
            }
            rank -= 1;
          }
          topScores[rank] = candidateScore;
          topCosts[rank] = combination.cost;
          for (let position = 0; position < setSize; position += 1) {
            topMeasures[rank * setSize + position] = indices[position];
            topDistricts[rank * setSize + position] = assignment[position];
          }
          topCount = Math.min(10, topCount + 1);
        }
      }

      // Mixed-radix enumeration visits every district assignment exactly once.
      let cursor = localPositions.length - 1;
      while (cursor >= 0) {
        const position = localPositions[cursor];
        assignment[position] += 1;
        if (assignment[position] < districtCount) break;
        assignment[position] = 0;
        cursor -= 1;
      }
      hasNext = cursor >= 0;
      visited += 1;
      if (visited % 2048 === 0) await setImmediate();
    }
  }

  return Array.from({ length: topCount }, (_, rank): BestSet => ({
    decisions: Array.from({ length: setSize }, (_, position): Decision => {
      const offset = rank * setSize + position;
      const district = topDistricts[offset];
      return {
        measureId: measures[topMeasures[offset]].id,
        ...(district < 0 ? {} : { districtId: districts[district].id }),
      };
    }),
    score: topScores[rank],
    cost: topCosts[rank],
  }));
}

const pendingSearches = new Map<string, Promise<BestSet[]>>();

export function bestOverall(): Promise<BestSet[]> {
  const path = resolve(process.cwd(), "data/best.json");
  const pending = pendingSearches.get(path);
  if (pending) return pending;
  const search = (async () => {
    const cached = await readCache(path);
    if (cached) return cached;
    const sets = await enumerateBest();
    await writeCache(path, sets);
    return sets;
  })().finally(() => pendingSearches.delete(path));
  pendingSearches.set(path, search);
  return search;
}
