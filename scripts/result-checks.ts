import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import scenarios from "../data/sample/scenarios.json";
import { score } from "../lib/engine/score";
import { validate } from "../lib/engine/validate";
import { agentAnalysisSchema, calculationSchema } from "../lib/result-schema";
import { applySuggestion } from "../lib/suggestions";
import { dispatchTool } from "../lib/agent/tools";

async function main() {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const previousDirectory = process.cwd();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "akim-api-checks-"));
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests += 1;
    throw new Error("Проверка API не должна вызывать сеть");
  };
  try {
    process.chdir(temporaryDirectory);
    const [{ POST: calculate }, { POST: analyze }] = await Promise.all([
      import("../app/api/calc/route"), import("../app/api/analyze/route"),
    ]);
    const request = (body: unknown) => new Request("http://localhost/api", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const decisions = scenarios[0].decisions;
    const before = JSON.stringify(decisions);
    // A configured key must not cause the numerical endpoint to contact OpenAI.
    process.env.OPENAI_API_KEY = "offline-placeholder-not-a-secret";
    const response = await calculate(request({ decisions }));
    assert.equal(response.status, 200);
    const calculationBody: unknown = await response.json();
    const result = calculationSchema.parse(calculationBody);
    assert.deepEqual(Object.keys(calculationBody as object).sort(), [
      "activeEvent", "bestKnownScore", "calc", "cost", "optimalDecisions", "scoreBeforeEvent", "suggestions",
    ]);
    assert.equal(networkRequests, 0);
    assert.deepEqual(result.calc, score(decisions));
    assert.equal(result.cost, 95);
    assert.equal(result.bestKnownScore.toFixed(2), "57.24");
    assert.equal(validate(result.optimalDecisions).ok, true);
    assert.equal(score(result.optimalDecisions).score, result.bestKnownScore);

    const toolResult = dispatchTool("suggest_swaps", {
      decisions: decisions.map((decision) => ({ ...decision, districtId: decision.districtId ?? null })),
    }, decisions).output as { suggestions: { change: string; delta: number }[] };
    assert.equal(result.suggestions.length, toolResult.suggestions.length);
    for (const [index, suggestion] of result.suggestions.entries()) {
      assert.equal(suggestion.change, toolResult.suggestions[index].change);
      assert.equal(Number(suggestion.delta.toFixed(2)), toolResult.suggestions[index].delta);
      const updated = applySuggestion(decisions, suggestion);
      assert.equal(validate(updated).ok, true);
      assert.equal(score(updated).score, suggestion.newScore);
      assert.equal(updated.filter((decision, position) => JSON.stringify(decision) !== JSON.stringify(decisions[position])).length, 1);
    }
    assert.equal(JSON.stringify(decisions), before);

    delete process.env.OPENAI_API_KEY;
    const analysisResponse = await analyze(request({ decisions }));
    assert.equal(analysisResponse.status, 200);
    const analysisBody: unknown = await analysisResponse.json();
    const analysis = agentAnalysisSchema.parse(analysisBody);
    assert.equal(analysis.report, null);
    assert.match(analysis.aiError ?? "", /OPENAI_API_KEY|ключ/i);
    assert.deepEqual(Object.keys(analysisBody as object).sort(), ["aiError", "report", "steps"]);
    assert.equal(networkRequests, 0);

    for (const endpoint of [calculate, analyze]) {
      const malformed = await endpoint(new Request("http://localhost/api", { method: "POST", body: "{" }));
      assert.equal(malformed.status, 400);
      assert.match((await malformed.json() as { error: string }).error, /JSON/);
      for (const body of [null, {}, { decisions: decisions.slice(0, 4) },
        { decisions: [{ measureId: "unknown" }, ...decisions.slice(1)] },
        ...["unknown", "", null, 42].map((eventId) => ({ decisions, eventId }))]) {
        const rejected = await endpoint(request(body));
        assert.equal(rejected.status, 400);
        const payload = await rejected.json() as { error?: string; errors?: string[]; stack?: string };
        assert.ok(payload.error || payload.errors?.length);
        assert.equal(payload.stack, undefined);
      }
    }

    // A cache I/O failure belongs to calc only and must not leak filesystem details.
    const cachePath = path.join(temporaryDirectory, "data", "best.json");
    await rm(cachePath);
    await mkdir(cachePath);
    const failedCalculation = await calculate(request({ decisions }));
    assert.equal(failedCalculation.status, 500);
    const failure = await failedCalculation.json() as { error: string };
    assert.deepEqual(failure, { error: "Не удалось рассчитать результат. Попробуйте ещё раз." });
    assert.ok(!JSON.stringify(failure).includes(temporaryDirectory));
    assert.equal((await analyze(request({ decisions }))).status, 200);
    assert.equal(networkRequests, 0);
    console.log("Проверки результата пройдены: отдельные calc/analyze, отсутствие сетевых вызовов в calc, оптимум и 5 замен, ошибки входа обоих API и безопасная ошибка кэша.");
  } finally {
    globalThis.fetch = previousFetch;
    process.chdir(previousDirectory);
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`Проверки результата не пройдены: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  process.exitCode = 1;
});
