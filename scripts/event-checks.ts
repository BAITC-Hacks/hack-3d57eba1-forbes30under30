import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { districts, measures, referenceValues, type Decision } from "../lib/engine/data";
import { events, getEvent, getStartingDistricts, type ScoreOptions } from "../lib/engine/events";
import { bestOverall, suggestSwaps } from "../lib/engine/optimize";
import { score } from "../lib/engine/score";
import { validate } from "../lib/engine/validate";

const example: Decision[] = referenceValues.exampleSet.decisions.map(([measureId, districtId]) => ({
  measureId, ...(districtId === null ? {} : { districtId }),
}));
const near = (actual: number, expected: number) => assert.ok(
  Math.abs(actual - expected) < 1e-9, `Ожидалось ${expected}, получено ${actual}`,
);

async function main(): Promise<void> {
  let passed = 0;
  async function check(name: string, test: () => void | Promise<void>): Promise<void> {
    await test();
    passed += 1;
    console.log(`OK: ${name}`);
  }

  await check("без события базовые результаты полностью совместимы", () => {
    assert.equal(score([]).score.toFixed(2), "52.56");
    assert.equal(score(example).score.toFixed(2), "56.54");
    assert.deepEqual(score(example), score(example, {}));
    assert.deepEqual(score(example), score(example, { eventId: undefined }));
    assert.equal(getEvent(), undefined);
    assert.deepEqual(getStartingDistricts(), districts);
  });

  await check("неизвестное событие отклоняется во всех точках входа", () => {
    const options = { eventId: "../unexpected" };
    for (const call of [
      () => getEvent(options.eventId), () => getStartingDistricts(options),
      () => score([], options), () => suggestSwaps(example, options), () => bestOverall(options),
    ]) assert.throws(call, /Неизвестное событие/);
  });

  await check("событие ограничивает исходные показатели до применения мер", () => {
    events.push({
      id: "clip-check", title: "Тест границ", description: "Только для изолированной проверки",
      effects: { almaty: { C1: -200, S1: 200 } },
    });
    try {
      const result = score([{ measureId: "M13", districtId: "almaty" }], { eventId: "clip-check" });
      const almaty = result.districts.find(({ id }) => id === "almaty")!;
      assert.equal(almaty.before.C1, 0);
      assert.equal(almaty.after.C1, 9);
      assert.equal(almaty.before.S1, 100);
      assert.equal(almaty.after.S1, 100);
      assert.equal(districts.find(({ id }) => id === "almaty")!.values.C1, 50);
    } finally {
      events.pop();
    }
  });

  for (const event of events) {
    await check(`${event.title}: исходные данные, база, вклады и замены`, () => {
      const originalData = JSON.stringify(districts);
      const originalDecisions = JSON.stringify(example);
      const options: ScoreOptions = { eventId: event.id };
      const baseline = score([], options);
      const result = score(example, options);
      assert.ok(baseline.score < score([]).score);
      assert.ok(result.score < score(example).score);
      assert.equal(result.baseScore, baseline.score);
      near(result.delta, result.score - baseline.score);
      for (const district of result.districts) {
        assert.deepEqual(district.before, baseline.districts.find(({ id }) => id === district.id)!.after);
        assert.equal(district.D_before, baseline.districts.find(({ id }) => id === district.id)!.D_after);
      }
      result.contributions.forEach((contribution, index) => {
        near(contribution.contribution, result.score - score(example.filter((_, position) => position !== index), options).score);
      });
      const suggestions = suggestSwaps(example, options);
      assert.ok(suggestions.length > 0);
      for (const [index, suggestion] of suggestions.entries()) {
        const candidate = example.map((decision) => decision.measureId === suggestion.replace ? {
          measureId: suggestion.with,
          ...(suggestion.districtId === undefined ? {} : { districtId: suggestion.districtId }),
        } : decision);
        assert.equal(validate(candidate).ok, true);
        near(suggestion.newScore, score(candidate, options).score);
        near(suggestion.delta, suggestion.newScore - result.score);
        assert.ok(suggestion.delta > 0);
        if (index > 0) assert.ok(suggestions[index - 1].delta >= suggestion.delta);
      }
      assert.equal(JSON.stringify(districts), originalData);
      assert.equal(JSON.stringify(example), originalDecisions);
      console.log(`${event.id}: база ${baseline.score.toFixed(2)}, пример ${result.score.toFixed(2)}, лучшая замена +${suggestions[0].delta.toFixed(2)}.`);
    });
  }

  const originalDirectory = process.cwd();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "akim-event-checks-"));
  try {
    process.chdir(temporaryDirectory);
    const originalBest = await bestOverall();
    const normalCachePath = join(temporaryDirectory, "data", "best.json");
    const normalCache = await readFile(normalCachePath, "utf8");
    for (const event of events) {
      await check(`${event.title}: полный поиск и отдельный кэш`, async () => {
        const options = { eventId: event.id };
        const started = performance.now();
        const [best, concurrent] = await Promise.all([bestOverall(options), bestOverall(options)]);
        assert.deepEqual(concurrent, best);
        assert.equal(best.length, 10);
        for (const [index, candidate] of best.entries()) {
          assert.equal(validate(candidate.decisions).ok, true);
          near(candidate.score, score(candidate.decisions, options).score);
          assert.equal(candidate.cost, candidate.decisions.reduce((sum, decision) => (
            sum + measures.find(({ id }) => id === decision.measureId)!.cost
          ), 0));
          if (index > 0) assert.ok(best[index - 1].score >= candidate.score);
        }
        assert.ok(best[0].score >= score(example, options).score);
        console.log(`${event.id}: bestOverall ${best[0].score.toFixed(2)} за ${(performance.now() - started).toFixed(1)} мс.`);
        const cachePath = `${normalCachePath}.${event.id}`;
        const oldTime = new Date("2000-01-01T00:00:00Z");
        await utimes(cachePath, oldTime, oldTime);
        assert.deepEqual(await bestOverall(options), best);
        assert.equal((await stat(cachePath)).mtimeMs, oldTime.getTime(), "Готовый кэш не должен пересчитываться");
        assert.equal(await readFile(normalCachePath, "utf8"), normalCache);

        // A normal-city cache at an event path must never be trusted.
        await writeFile(cachePath, normalCache, "utf8");
        assert.deepEqual(await bestOverall(options), best);
      });
    }
    assert.deepEqual(await bestOverall(), originalBest);
  } finally {
    process.chdir(originalDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  console.log(`Проверки событий пройдены: ${passed}. Кэши проекта не изменены.`);
}

main().catch((error: unknown) => {
  console.error(`Проверки событий не пройдены: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  process.exitCode = 1;
});
