import assert from "node:assert/strict";
import scenarios from "../data/sample/scenarios.json";
import { score } from "../lib/engine/score";
import { validate } from "../lib/engine/validate";
import { analysisSchema } from "../lib/result-schema";
import { applySuggestion } from "../lib/suggestions";
import { dispatchTool } from "../lib/agent/tools";

async function main() {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { POST } = await import("../app/api/analyze/route");
    const decisions = scenarios[0].decisions;
    const before = JSON.stringify(decisions);
    const response = await POST(new Request("http://localhost/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisions }),
    }));
    assert.equal(response.status, 200);
    const result = analysisSchema.parse(await response.json());
    assert.equal(result.report, null);
    assert.ok(result.aiError);
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
    console.log("Проверки результата пройдены: полный ответ без AI, оптимальный набор, точное совпадение рекомендаций и применение всех 5 замен без изменения исходного набора.");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}

main().catch((error: unknown) => {
  console.error(`Проверки результата не пройдены: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  process.exitCode = 1;
});
