import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import scenarios from "../data/sample/scenarios.json";
import { POST as analyze } from "../app/api/analyze/route";
import { POST as calculate } from "../app/api/calc/route";
import { GET, POST as save } from "../app/api/scenarios/route";
import { score } from "../lib/engine/score";
import { agentAnalysisSchema, calculationSchema } from "../lib/result-schema";
import { savedScenarioSchema } from "../lib/scenarios/schema";
import { applySuggestion } from "../lib/suggestions";
import { buildMarkdownReport } from "../lib/markdown-report";

const decisions = scenarios[0].decisions;
const eventId = "almaty-heating";
const request = (body: unknown) => new Request("http://localhost/api", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

async function main() {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousDirectory = process.cwd();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "akim-event-integration-"));
  delete process.env.OPENAI_API_KEY;
  try {
    process.chdir(temporaryDirectory);
    const response = await calculate(request({ decisions, eventId }));
    assert.equal(response.status, 200);
    const result = calculationSchema.parse(await response.json());
    const agentResponse = await analyze(request({ decisions, eventId }));
    assert.equal(agentResponse.status, 200);
    const agent = agentAnalysisSchema.parse(await agentResponse.json());
    assert.equal(agent.report, null);
    assert.ok(agent.aiError);
    assert.equal(result.eventId, eventId);
    assert.equal(result.activeEvent?.id, eventId);
    assert.deepEqual(result.calc, score(decisions, { eventId }));
    assert.equal(result.scoreBeforeEvent.toFixed(2), "56.54");
    assert.equal(result.calc.score.toFixed(2), "55.34");
    assert.equal(result.bestKnownScore.toFixed(2), "57.04");
    assert.equal(score(result.optimalDecisions, { eventId }).score, result.bestKnownScore);
    for (const suggestion of result.suggestions) {
      const updated = applySuggestion(decisions, suggestion);
      assert.equal(score(updated, { eventId }).score, suggestion.newScore);
      assert.ok(Math.abs(suggestion.newScore - result.calc.score - suggestion.delta) < 1e-10);
    }
    console.log("✓ API без AI возвращает расчёт, замены и оптимум для одного события");

    assert.deepEqual(await (await GET()).json(), []);
    const savedResponse = await save(request({ name: "Авария | Алматы", decisions, eventId, score: 999 }));
    assert.equal(savedResponse.status, 201);
    const saved = savedScenarioSchema.parse(await savedResponse.json());
    assert.equal(saved.eventId, eventId);
    assert.equal(saved.score, result.calc.score);
    const reloaded = savedScenarioSchema.array().parse(await (await GET()).json());
    assert.deepEqual(reloaded, [saved]);
    assert.equal(score(reloaded[0].decisions, { eventId: reloaded[0].eventId }).score, saved.score);
    console.log("✓ Первое сохранение создаёт файл и сохраняет событие для повторного расчёта");

    for (const invalidEvent of ["unknown", "", null, 123]) {
      assert.equal((await calculate(request({ decisions, eventId: invalidEvent }))).status, 400);
      assert.equal((await analyze(request({ decisions, eventId: invalidEvent }))).status, 400);
      assert.equal((await save(request({ name: "Ошибка", decisions, eventId: invalidEvent }))).status, 400);
    }
    assert.deepEqual(await (await GET()).json(), [saved]);
    console.log("✓ Неизвестные события отклоняются всеми API без изменения сценариев");

    const report = {
      summary: "Разбор <script> и таблица | результата",
      strengths: [], risks: [], tradeoffs: [],
      recommendations: [{ change: result.suggestions[0].change, expectedDelta: result.suggestions[0].delta, why: "Подтверждено расчётом." }],
    };
    const markdown = buildMarkdownReport({
      name: "Команда | <Астана>\n# Заголовок", decisions,
      calc: result.calc, cost: result.cost, report, activeEvent: result.activeEvent,
    });
    assert.ok(markdown.startsWith("# Команда \\| &lt;Астана&gt; \\# Заголовок\n"));
    for (const expected of ["55,34", "51,36", "95 из 100", "Авария на теплосетях в Алматы", "C1 −12", "D до мер", "D после мер", "Критические значения", "Ожидаемая дельта Score", "&lt;script&gt;"]) {
      assert.ok(markdown.includes(expected), `Отчёт не содержит ${expected}`);
    }
    for (const decision of decisions) assert.ok(markdown.includes(`| ${decision.measureId} `));
    const withoutAI = buildMarkdownReport({ name: "", decisions, calc: score(decisions), cost: 95, report: null });
    assert.ok(withoutAI.includes("Событие не активно."));
    assert.ok(withoutAI.includes("AI-разбор недоступен"));
    console.log("✓ Markdown содержит меры, событие, расчёт, критические значения и рекомендации; работает без AI");
  } finally {
    process.chdir(previousDirectory);
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`Интеграционная проверка событий не прошла: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  process.exitCode = 1;
});
