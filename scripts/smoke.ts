import { existsSync } from "node:fs";
import type { Decision } from "../lib/engine/data";

let checks = 0;

function equal(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`,
    );
  }
}

function near(label: string, actual: number, expected: number): void {
  checks += 1;
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-10) {
    throw new Error(`${label}: ожидалось ${expected}, получено ${actual}`);
  }
}

async function main(): Promise<void> {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
  } catch {
    throw new Error("Не удалось загрузить .env для смоук-теста. Проверьте файл и используйте Node.js 20.12 или новее.");
  }
  // Keep imports inside the error boundary so missing/invalid data fail cleanly.
  const [{ districtsData, measuresData, measures }, { validate }, { score }, fixtures] =
    await Promise.all([
      import("../lib/engine/data"),
      import("../lib/engine/validate"),
      import("../lib/engine/score"),
      import("../data/sample/scenarios.json"),
    ]);
  const scenarios = fixtures.default;
  const dataBefore = JSON.stringify({ districtsData, measuresData });
  const scenariosBefore = JSON.stringify(scenarios);
  const base = score([]);
  equal("Базовый Score", base.score.toFixed(2), "52.56");
  equal("Базовый D_avg", base.dAvg.toFixed(2), "56.86");
  equal("Базовый min(D)", base.minDistrict.toFixed(2), "49.18");
  equal("Критические показатели базы", base.criticals.length, 2);
  equal("Порог строгий: 40 не является критическим", base.criticals.every((item) => item.value < 40), true);
  near("Пустой набор: дельта", base.delta, 0);
  console.log(`База: Score = ${base.score.toFixed(2)}`);

  for (const scenario of scenarios) {
    equal(`${scenario.name}: валидация`, validate(scenario.decisions), { ok: true, errors: [] });
    const result = score(scenario.decisions);
    const cost = scenario.decisions.reduce((total, decision) => {
      const measure = measures.find((item) => item.id === decision.measureId);
      if (!measure) throw new Error(`Ожидалась мера ${decision.measureId}, получено: не найдена`);
      return total + measure.cost;
    }, 0);
    equal(`${scenario.name}: Score`, result.score.toFixed(2), scenario.expectedScore.toFixed(2));
    equal(`${scenario.name}: стоимость`, cost, scenario.expectedCost);
    near(`${scenario.name}: база`, result.baseScore, base.score);
    near(`${scenario.name}: дельта без округления`, result.delta, result.score - base.score);
    equal(`${scenario.name}: число вкладов`, result.contributions.length, 5);
    for (const contribution of result.contributions) {
      const without = scenario.decisions.filter((item) => item.measureId !== contribution.measureId);
      near(`${scenario.name}: вклад ${contribution.measureId}`, contribution.contribution, result.score - score(without).score);
    }
    console.log(`${scenario.name}: Score = ${result.score.toFixed(2)}, стоимость = ${cost}`);
  }

  const example = scenarios[0].decisions;
  function reject(label: string, input: unknown, reason: RegExp): void {
    const result = validate(input);
    equal(`${label}: отклонён`, result.ok, false);
    equal(`${label}: причина ${reason.source}; ошибки: ${result.errors.join("; ")}`, result.errors.some((error) => reason.test(error)), true);
  }
  const district = (measureId: string, districtId = "nura"): Decision => ({ measureId, districtId });
  const city = (measureId: string): Decision => ({ measureId });
  reject("Четыре решения", example.slice(0, 4), /ровно.*5/i);
  reject("Повтор меры", [...example.slice(0, 4), example[0]], /повтор/i);
  reject("Бюджет 113", [city("M2"), district("M3"), district("M5", "esil"), district("M8"), city("M14")], /бюджет/i);
  reject("M1+M3 в разных районах", [district("M1", "esil"), district("M3"), district("M9"), district("M10"), city("M12")], /M1.*M3.*несовмест/i);
  const parkAndSchool = [district("M4"), district("M7"), district("M8"), district("M10"), city("M12")];
  reject("M4+M7 в одном районе", parkAndSchool, /M4.*M7.*несовмест/i);
  equal("M4+M7 в разных районах разрешены", validate([district("M4", "esil"), ...parkAndSchool.slice(1)]), { ok: true, errors: [] });
  const fuelAndUtilities = [district("M5"), district("M13"), district("M9"), district("M10"), city("M12")];
  reject("M5+M13 в одном районе", fuelAndUtilities, /M5.*M13.*несовмест/i);
  equal("M5+M13 в разных районах разрешены", validate([district("M5", "esil"), ...fuelAndUtilities.slice(1)]), { ok: true, errors: [] });
  reject("Три меры транспорта", [district("M1"), city("M2"), district("M3"), district("M9"), city("M12")], /Транспорт/);
  reject("Городская мера с районом", example.map((item) => item.measureId === "M12" ? district("M12") : item), /городская.*не должна.*район/i);
  reject("Районная мера без района", [city("M7"), ...example.slice(1)], /районной.*район/i);
  reject("Неизвестная мера", [city("M404"), ...example.slice(1)], /неизвестная мера/i);
  reject("Неизвестный район", [district("M7", "missing"), ...example.slice(1)], /неизвестный район/i);
  reject("Вход не является массивом", null, /массив/i);
  equal("Бюджет ровно 100 разрешён", validate([...example.slice(0, 4), district("M3")]), { ok: true, errors: [] });

  const transport = score([district("M1"), city("M2")]);
  const nura = transport.districts.find((item) => item.id === "nura");
  if (!nura) throw new Error("Ожидался район nura, получено: не найден");
  near("Лаги и фиксированная синергия M1+M2", nura.after.T1, 64.5);
  equal("Синергия действует только в районе первой меры пары", transport.synergiesApplied[0]?.districtIds, ["nura"]);
  for (const item of transport.districts.filter((item) => item.id !== "nura")) {
    near(`${item.id}: городская мера действует повсюду`, item.after.T1, item.before.T1 + 3);
    near(`${item.id}: районная мера не затронула T2`, item.after.T2, item.before.T2);
  }
  near("Порядок решений не меняет результат", score([city("M2"), district("M1")]).score, transport.score);
  const safety = score([district("M11")]).districts.find((item) => item.id === "nura");
  near("Отрицательный эффект и лаг M11", safety?.after.T1 ?? NaN, 53.25);
  const ecology = score([district("M5"), city("M6")]);
  near("Фиксированная синергия M5+M6", ecology.districts.find((item) => item.id === "nura")?.after.E2 ?? NaN, 77.25);
  const exampleResult = score(example);
  near("Фиксированная синергия M10+M12", exampleResult.districts.find((item) => item.id === "nura")?.after.B1 ?? NaN, 67.5);
  equal("Исходные датасеты не изменились", JSON.stringify({ districtsData, measuresData }), dataBefore);
  equal("Входные решения не изменились", JSON.stringify(scenarios), scenariosBefore);

  const { bestOverall, suggestSwaps } = await import("../lib/engine/optimize");
  const suggestions = suggestSwaps(example);
  equal("Для примера есть замена с положительной дельтой", suggestions.some((item) => item.delta > 0), true);
  console.log(`Замены примера: ${suggestions.map((item) => `${item.replace} → ${item.with}${item.districtId ? `@${item.districtId}` : ""}: +${item.delta.toFixed(2)}`).join("; ")}`);
  const cached = existsSync("data/best.json");
  const started = performance.now();
  const best = await bestOverall();
  const elapsed = performance.now() - started;
  equal("bestOverall возвращает топ-10", best.length, 10);
  equal(`Лучший Score не ниже 57.24; получено ${best[0]?.score.toFixed(2)}`, best[0]?.score >= score(scenarios[2].decisions).score - 1e-10, true);
  equal("Лучший набор валиден", validate(best[0].decisions), { ok: true, errors: [] });
  near("Лучший Score подтверждён основным движком", best[0].score, score(best[0].decisions).score);
  console.log(`bestOverall: ${elapsed.toFixed(1)} мс (${cached ? "кэш" : "полный перебор"}); Score = ${best[0].score.toFixed(2)}, стоимость = ${best[0].cost}; ${best[0].decisions.map((item) => `${item.measureId}${item.districtId ? `@${item.districtId}` : ""}`).join(", ")}`);

  if (process.env.OPENAI_API_KEY?.trim()) {
    const [{ runAgent }, { reportSchema }] = await Promise.all([
      import("../lib/agent"),
      import("../lib/agent/schemas"),
    ]);
    console.log("AI-смоук: агент анализирует пример из ТЗ…");
    const result = await runAgent(example);
    if (result.report === null) {
      throw new Error(`AI-отчёт: ожидался валидный отчёт, получено: ${result.aiError ?? "отчёт отсутствует"}`);
    }
    equal("AI-отчёт соответствует схеме", reportSchema.safeParse(result.report).success, true);
    const scoreStep = result.steps.findIndex((step) => step.name === "score_set");
    const contributionsStep = result.steps.findIndex((step) => step.name === "get_contributions");
    const suggestionsStep = result.steps.findIndex((step) => step.name === "suggest_swaps");
    equal("AI вызвал score_set", scoreStep >= 0, true);
    equal("AI вызвал get_contributions после score_set", contributionsStep > scoreStep, true);
    equal("AI вызвал suggest_swaps после get_contributions", suggestionsStep > contributionsStep, true);
    console.log(`AI-отчёт для примера из ТЗ:\n${JSON.stringify(result.report, null, 2)}`);
    console.log(`AI-инструменты: ${result.steps.map((step) => step.name).join(" → ")}`);
  } else {
    console.log("AI-смоук пропущен: OPENAI_API_KEY не задан.");
  }
  console.log(`Смоук-тест пройден: ${checks} проверок.`);
}

main().catch((error: unknown) => {
  console.error(`Смоук-тест не пройден: ${error instanceof Error ? error.message : "ожидался успешный расчёт, получена неизвестная ошибка"}`);
  process.exitCode = 1;
});
