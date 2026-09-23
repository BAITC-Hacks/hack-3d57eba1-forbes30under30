import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import scenarios from "../data/sample/scenarios.json";
import { waitForBestScore } from "../lib/best-known";
import { districts, measures, type Decision } from "../lib/engine/data";
import { bestOverall, suggestSwaps, type BestSet } from "../lib/engine/optimize";
import { score } from "../lib/engine/score";
import { validate } from "../lib/engine/validate";

const epsilon = 1e-10;
const cost = (decisions: readonly Decision[]) => decisions.reduce((total, decision) => (
  total + measures.find((measure) => measure.id === decision.measureId)!.cost
), 0);
const key = (decisions: readonly Decision[]) => decisions.map(({ measureId, districtId }) => (
  `${measureId}@${districtId ?? "city"}`
)).sort().join("|");

function near(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < epsilon, `${label}: ожидалось ${expected}, получено ${actual}`);
}

function independentSwaps(decisions: readonly Decision[]): number[] {
  const baseline = score(decisions).score;
  const deltas: number[] = [];
  for (let index = 0; index < decisions.length; index += 1) {
    for (const measure of measures) {
      if (measure.id === decisions[index].measureId) continue;
      const candidates: Decision[] = measure.scope === "city"
        ? [{ measureId: measure.id }]
        : districts.map((district) => ({ measureId: measure.id, districtId: district.id }));
      for (const candidate of candidates) {
        const next = decisions.map((decision, position) => position === index ? candidate : decision);
        if (!validate(next).ok) continue;
        const delta = score(next).score - baseline;
        if (delta > 0) deltas.push(delta);
      }
    }
  }
  return deltas.sort((left, right) => right - left).slice(0, 5);
}

async function main(): Promise<void> {
  let passed = 0;
  async function check(name: string, test: () => Promise<void> | void): Promise<void> {
    await test();
    passed += 1;
    console.log(`OK: ${name}`);
  }

  for (const scenario of scenarios) {
    await check(`замены «${scenario.name}»: точные Score, дельты, стоимость и топ-5`, () => {
      const original = structuredClone(scenario.decisions);
      const suggestions = suggestSwaps(scenario.decisions);
      const expected = independentSwaps(scenario.decisions);
      assert.equal(suggestions.length, expected.length);
      const seen = new Set<string>();
      for (const [index, suggestion] of suggestions.entries()) {
        assert.ok(suggestion.delta > 0);
        assert.notEqual(suggestion.replace, suggestion.with);
        assert.equal(scenario.decisions.filter(({ measureId }) => measureId === suggestion.replace).length, 1);
        const next = scenario.decisions.map((decision) => decision.measureId === suggestion.replace ? {
          measureId: suggestion.with,
          ...(suggestion.districtId === undefined ? {} : { districtId: suggestion.districtId }),
        } : decision);
        assert.equal(validate(next).ok, true);
        const actualScore = score(next).score;
        near(suggestion.newScore, actualScore, "Score замены");
        near(suggestion.delta, actualScore - score(original).score, "Дельта замены");
        near(suggestion.delta, expected[index], "Позиция в топ-5");
        assert.equal(suggestion.cost, cost(next));
        assert.ok(!seen.has(key(next)), "Рекомендации не должны повторять один набор");
        seen.add(key(next));
      }
      assert.deepEqual(scenario.decisions, original, "Поиск не меняет входной набор");
    });
  }

  // Keep cache tests isolated from data/best.json in the working project.
  const originalDirectory = process.cwd();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "akim-optimize-checks-"));
  let best: BestSet[] = [];
  try {
    process.chdir(temporaryDirectory);
    const cachePath = join(temporaryDirectory, "data", "best.json");
    await check("холодный полный поиск: конкурентные вызовы и работа цикла событий", async () => {
      let heartbeatCount = 0;
      let previousBeat = performance.now();
      let longestPause = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        longestPause = Math.max(longestPause, now - previousBeat);
        previousBeat = now;
        heartbeatCount += 1;
      }, 5);
      const started = performance.now();
      try {
        const [first, second] = await Promise.all([bestOverall(), bestOverall()]);
        best = first;
        assert.deepEqual(first, second);
      } finally {
        clearInterval(heartbeat);
      }
      const elapsed = performance.now() - started;
      assert.ok(heartbeatCount > 0, "Полный поиск должен отдавать управление циклу событий");
      assert.ok(longestPause < 500, `Поиск заблокировал цикл событий на ${longestPause.toFixed(1)} мс`);
      console.log(`bestOverall без кэша: ${elapsed.toFixed(1)} мс; heartbeat: ${heartbeatCount}; максимальная пауза: ${longestPause.toFixed(1)} мс.`);
    });

    await check("топ-10 полного поиска: валидность, порядок и совпадение с исходным движком", () => {
      assert.equal(best.length, 10);
      assert.ok(Number(best[0].score.toFixed(2)) >= 57.24);
      const seen = new Set<string>();
      for (const [index, candidate] of best.entries()) {
        const validation = validate(candidate.decisions);
        assert.equal(validation.ok, true, validation.errors.join(" "));
        near(candidate.score, score(candidate.decisions).score, "Score полного поиска");
        assert.equal(candidate.cost, cost(candidate.decisions));
        assert.ok(!seen.has(key(candidate.decisions)), "Топ-10 не должен повторять наборы");
        seen.add(key(candidate.decisions));
        if (index > 0) assert.ok(best[index - 1].score >= candidate.score);
      }
    });

    await check("готовый кэш читается и не перезаписывается", async () => {
      const originalCache = await readFile(cachePath, "utf8");
      const timestamp = new Date("2000-01-01T00:00:00Z");
      await utimes(cachePath, timestamp, timestamp);
      const result = await bestOverall();
      assert.deepEqual(result, best);
      assert.equal(await readFile(cachePath, "utf8"), originalCache);
      assert.equal((await stat(cachePath)).mtimeMs, timestamp.getTime());
    });

    await check("повреждённый кэш пересчитывается в рабочий результат", async () => {
      await writeFile(cachePath, "{broken cache", "utf8");
      assert.deepEqual(await bestOverall(), best);
      const repairedCache = await readFile(cachePath, "utf8");
      assert.doesNotThrow(() => JSON.parse(repairedCache));
    });
  } finally {
    process.chdir(originalDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  await check("ожидание лучшего Score возвращает готовый результат и обрабатывает отказ", async () => {
    assert.equal(await waitForBestScore(Promise.resolve(best)), best[0].score);
    assert.equal(await waitForBestScore(Promise.reject(new Error("Ошибка чтения тестового кэша"))), undefined);
  });

  await check("таймаут ожидания не отменяет фоновый поиск и безопасен при поздней ошибке", async () => {
    let complete!: (sets: BestSet[]) => void;
    const background = new Promise<BestSet[]>((resolve) => { complete = resolve; });
    assert.equal(await waitForBestScore(background, 10), undefined);
    complete(best);
    assert.deepEqual(await background, best);

    const unhandled: unknown[] = [];
    const captureRejection = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", captureRejection);
    try {
      let fail!: (error: Error) => void;
      const rejected = new Promise<BestSet[]>((_resolve, reject) => { fail = reject; });
      assert.equal(await waitForBestScore(rejected, 10), undefined);
      fail(new Error("Поздняя ошибка тестового кэша"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", captureRejection);
    }
  });

  console.log(`Проверки оптимизатора пройдены: ${passed}. Кэш проекта не изменён.`);
}

main().catch((error: unknown) => {
  console.error(`Проверки оптимизатора не пройдены: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  process.exitCode = 1;
});
