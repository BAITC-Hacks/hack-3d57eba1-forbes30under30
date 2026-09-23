import assert from "node:assert/strict";
import scenarios from "../data/sample/scenarios.json";
import { score } from "../lib/engine/score";

type CompletionRequest = {
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  parallel_tool_calls?: boolean;
  messages: { role: string; content?: string | null; tool_call_id?: string }[];
};

const example = scenarios[0].decisions;
const input = { decisions: example.map((decision) => ({ ...decision, districtId: decision.districtId ?? null })) };
const validReport = {
  summary: "Score 56.54. Сценарий улучшил качество жизни по расчёту движка.",
  strengths: ["M7 и M8 усиливают социальную инфраструктуру; M10 повышает безопасность, M12 улучшает обращения, M5 — воздух."],
  risks: ["Транспорт не затронут выбранными мерами."],
  tradeoffs: ["Самый слабый район имеет вес 30%. За каждый показатель ниже 40 начисляется штраф 1. Длинный лаг задерживает эффект."],
  recommendations: [] as { change: string; expectedDelta: number; why: string }[],
};

function completion(message: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    id: "offline-completion",
    object: "chat.completion",
    created: 0,
    model: "offline-model",
    choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message: { role: "assistant", ...message } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function tool(name: string, args: unknown = input): Response {
  return completion({ content: null, tool_calls: [{ id: `call-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
}

function final(content: unknown = validReport): Response {
  return completion({ content: typeof content === "string" ? content : JSON.stringify(content) });
}

function firstTools(index: number): Response | undefined {
  const name = ["score_set", "get_contributions", "suggest_swaps"][index];
  return name === undefined ? undefined : tool(name);
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const requests: CompletionRequest[] = [];
  let respond: (request: CompletionRequest, index: number, signal?: AbortSignal | null) => Response | Promise<Response> = () => {
    throw new Error("Незапланированный запрос в офлайн-тесте");
  };
  // All SDK requests are intercepted before loading the agent. This suite must
  // never send a real key or use the network, including when .env is configured.
  globalThis.fetch = async (resource, init) => {
    const body = typeof init?.body === "string"
      ? init.body
      : resource instanceof Request ? await resource.text() : "";
    const request = JSON.parse(body) as CompletionRequest;
    requests.push(request);
    return respond(request, requests.length - 1, init?.signal ?? (resource instanceof Request ? resource.signal : undefined));
  };
  process.env.OPENAI_API_KEY = "offline-placeholder-not-a-secret";

  try {
    const [{ runAgent }, { reportSchema }, { dispatchTool }] = await Promise.all([
      import("../lib/agent"),
      import("../lib/agent/schemas"),
      import("../lib/agent/tools"),
    ]);
    const suggestionsOutput = dispatchTool("suggest_swaps", input, example).output as {
      suggestions: { change: string; delta: number }[];
    };
    assert.ok(suggestionsOutput.suggestions.length > 0, "Пример из ТЗ должен иметь рассчитанные улучшения");
    const suggestion = suggestionsOutput.suggestions[0];
    validReport.recommendations = [{
      change: suggestion.change,
      expectedDelta: suggestion.delta,
      why: "Замена улучшает Score по расчёту движка.",
    }];
    let passed = 0;
    async function check(name: string, test: () => Promise<void>): Promise<void> {
      requests.length = 0;
      await test();
      passed += 1;
      console.log(`OK: ${name}`);
    }

    await check("обязательные инструменты, результаты движка и валидный отчёт", async () => {
      respond = (_request, index) => firstTools(index) ?? final();
      const result = await runAgent(example);
      assert.ok(result.report, result.aiError);
      assert.equal(reportSchema.safeParse(result.report).success, true);
      assert.deepEqual(requests[0].tool_choice, { type: "function", function: { name: "score_set" } });
      assert.deepEqual(requests[1].tool_choice, { type: "function", function: { name: "get_contributions" } });
      assert.deepEqual(requests[2].tool_choice, { type: "function", function: { name: "suggest_swaps" } });
      assert.ok(requests.every((request) => request.parallel_tool_calls === false));
      assert.equal(requests.length, 4);
      const toolResults = requests[3].messages.filter((message) => message.role === "tool");
      assert.equal(toolResults.length, 3);
      assert.ok(toolResults.every((message) => Boolean(message.content)));
      assert.ok(result.steps.findIndex((step) => step.name === "score_set") < result.steps.findIndex((step) => step.name === "get_contributions"));
      assert.ok(result.steps.findIndex((step) => step.name === "get_contributions") < result.steps.findIndex((step) => step.name === "suggest_swaps"));
    });

    await check("без ключа: понятная ошибка без сетевых запросов", async () => {
      delete process.env.OPENAI_API_KEY;
      try {
        const result = await runAgent(example);
        assert.equal(result.report, null);
        assert.match(result.aiError ?? "", /ключ|OPENAI_API_KEY/i);
        assert.equal(requests.length, 0);
      } finally {
        process.env.OPENAI_API_KEY = "offline-placeholder-not-a-secret";
      }
    });

    await check("API сохраняет расчёт без ключа и отклоняет неверный набор", async () => {
      const { POST } = await import("../app/api/analyze/route");
      const makeRequest = (decisions: unknown) => new Request("http://localhost/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisions }),
      });
      delete process.env.OPENAI_API_KEY;
      try {
        const success = await POST(makeRequest(example));
        const body = await success.json() as {
          calc: { score: number }; report: unknown; steps: unknown[]; aiError?: string;
          suggestions: { delta: number }[]; bestKnownScore?: number;
        };
        assert.equal(success.status, 200);
        assert.equal(body.calc.score, score(example).score);
        assert.equal(body.report, null);
        assert.match(body.aiError ?? "", /ключ|OPENAI_API_KEY/i);
        assert.ok(Array.isArray(body.steps));
        assert.ok(body.suggestions.length > 0);
        assert.ok(body.suggestions.every(({ delta }) => delta > 0));
        if (body.bestKnownScore !== undefined) assert.ok(Number(body.bestKnownScore.toFixed(2)) >= 57.24);

        const invalid = await POST(makeRequest(example.slice(0, 4)));
        const errors = await invalid.json() as { errors: string[]; calc?: unknown };
        assert.equal(invalid.status, 400);
        assert.ok(errors.errors.some((error) => /ровно.*5/i.test(error)));
        assert.equal(errors.calc, undefined);
        assert.equal(requests.length, 0);
      } finally {
        process.env.OPENAI_API_KEY = "offline-placeholder-not-a-secret";
      }
    });

    await check("общий таймаут отменяет зависший запрос и сохраняет понятную ошибку", async () => {
      const originalSetTimeout = globalThis.setTimeout;
      let shortenedTimers = 0;
      let abortObserved = false;
      globalThis.setTimeout = new Proxy(originalSetTimeout, {
        apply(target, thisArg, args: unknown[]) {
          const [callback, delay, ...rest] = args;
          if (delay === 60_000) shortenedTimers += 1;
          return Reflect.apply(target, thisArg, [callback, delay === 60_000 ? 20 : delay, ...rest]);
        },
      });
      respond = (_request, _index, signal) => new Promise<Response>((_resolve, reject) => {
        assert.ok(signal, "SDK должен передавать сигнал отмены");
        const aborted = () => {
          abortObserved = true;
          reject(new DOMException("Offline request aborted", "AbortError"));
        };
        if (signal.aborted) aborted();
        else signal.addEventListener("abort", aborted, { once: true });
      });
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          runAgent(example),
          new Promise<never>((_resolve, reject) => {
            watchdog = originalSetTimeout(() => reject(new Error("Отмена запроса не сработала за секунду")), 1_000);
          }),
        ]);
        assert.equal(result.report, null);
        assert.match(result.aiError ?? "", /60 секунд/);
        assert.ok(shortenedTimers > 0);
        assert.equal(abortObserved, true);
        assert.equal(requests.length, 1);
        assert.ok(result.steps.some((step) => step.name === "error"));
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        if (watchdog !== undefined) clearTimeout(watchdog);
      }
    });

    await check("ошибка провайдера не раскрывает ответ или секреты", async () => {
      const marker = "PRIVATE_UPSTREAM_RESPONSE_MARKER";
      respond = () => new Response(JSON.stringify({ error: { message: marker, type: "invalid_request_error", code: "invalid_api_key" } }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.ok(!JSON.stringify(result).includes(marker));
      assert.ok(!JSON.stringify(result).includes("offline-placeholder"));
      assert.equal(requests.length, 1);
    });

    await check("ошибка схемы исправляется единственным повтором", async () => {
      respond = (_request, index) => firstTools(index) ?? (index === 3 ? final({ ...validReport, strengths: "не массив" }) : final());
      const result = await runAgent(example);
      assert.ok(result.report, result.aiError);
      assert.equal(requests.length, 5);
      assert.equal(requests[4].tool_choice, "none");
    });

    await check("невалидный JSON после повтора: ошибка и сохранённые шаги", async () => {
      respond = (_request, index) => firstTools(index) ?? final("это не JSON");
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.equal(requests.length, 5);
      assert.equal(requests[4].tool_choice, "none");
      assert.ok(result.steps.some((step) => step.name === "score_set"));
      assert.ok(result.steps.some((step) => step.name === "get_contributions"));
    });

    await check("неподтверждённые числа в отчёте отклоняются", async () => {
      respond = (_request, index) => firstTools(index) ?? final({ ...validReport, summary: "Score повысился до 987654.32." });
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.equal(requests.length, 5);
    });

    await check("число из расчёта не заменяет подтверждённую дельту рекомендации", async () => {
      respond = (_request, index) => firstTools(index) ?? final({
        ...validReport,
        recommendations: [{ change: "Заменить меру", expectedDelta: 56.54, why: "Нужна проверка альтернативы." }],
      });
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.equal(requests.length, 5);
    });

    await check("неподтверждённая замена с настоящей дельтой отклоняется", async () => {
      respond = (_request, index) => firstTools(index) ?? final({
        ...validReport,
        recommendations: [{ change: "Заменить M7 на несуществующую меру", expectedDelta: suggestion.delta, why: "Прогноз скопирован из другой замены." }],
      });
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.equal(requests.length, 5);
    });

    await check("expectedDelta обязателен и не принимает null", async () => {
      respond = (_request, index) => firstTools(index) ?? final({
        ...validReport,
        recommendations: [{ ...validReport.recommendations[0], expectedDelta: null }],
      });
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.equal(requests.length, 5);
      const { expectedDelta: _expectedDelta, ...withoutDelta } = validReport.recommendations[0];
      assert.equal(reportSchema.safeParse({ ...validReport, recommendations: [withoutDelta] }).success, false);
    });

    await check("пустые рекомендации отклоняются при рассчитанных улучшениях", async () => {
      respond = (_request, index) => firstTools(index) ?? final({ ...validReport, recommendations: [] });
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.equal(requests.length, 5);
    });

    await check("повтор одной рекомендации отклоняется", async () => {
      respond = (_request, index) => firstTools(index) ?? final({
        ...validReport,
        recommendations: [validReport.recommendations[0], validReport.recommendations[0]],
      });
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.equal(requests.length, 5);
    });

    await check("score_set другого сценария не обходит проверку suggest_swaps", async () => {
      const alternative = scenarios[2].decisions;
      const expectedDelta = Number((score(alternative).score - score(example).score).toFixed(2));
      respond = (_request, index) => firstTools(index) ?? (index === 3
        ? tool("score_set", { decisions: alternative.map((decision) => ({ ...decision, districtId: decision.districtId ?? null })) })
        : final({
          ...validReport,
          recommendations: [{ change: "Рассмотреть рассчитанный альтернативный набор", expectedDelta, why: "Сравнение сценариев выполнено движком." }],
        }));
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.equal(requests.length, 6);
    });

    await check("после восьми инструментов агент запрашивает только финал", async () => {
      respond = (_request, index) => firstTools(index) ?? (index < 8 ? tool("validate_set") : final());
      const result = await runAgent(example);
      assert.ok(result.report, result.aiError);
      assert.equal(requests.length, 9);
      assert.equal(requests[8].tool_choice, "none");
      assert.equal(result.steps.filter((step) => ["score_set", "get_contributions", "suggest_swaps", "validate_set", "get_district_profile"].includes(step.name)).length, 8);
    });

    await check("девятый инструмент запрещён даже при нарушении моделью", async () => {
      respond = (_request, index) => firstTools(index) ?? tool("validate_set");
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
      assert.ok(requests.length <= 10, "агент должен завершить работу после лимита и максимум одного повтора");
      assert.ok(result.steps.filter((step) => ["score_set", "get_contributions", "suggest_swaps", "validate_set", "get_district_profile"].includes(step.name)).length <= 8);
    });

    await check("обязательный расчёт нельзя подменить другим сценарием", async () => {
      respond = (_request, index) => index === 0
        ? tool("score_set", { decisions: input.decisions.map((decision) => decision.measureId === "M7" ? { ...decision, districtId: "esil" } : decision) })
        : firstTools(index) ?? final();
      const result = await runAgent(example);
      assert.equal(result.report, null);
      assert.ok(result.aiError);
    });

    await check("неизвестный район не мешает получить отчёт по исходному расчёту", async () => {
      respond = (_request, index) => firstTools(index) ?? (index === 3
        ? tool("get_district_profile", { ...input, districtId: "missing" })
        : final());
      const result = await runAgent(example);
      assert.ok(result.report, result.aiError);
      const lastToolResult = requests[4].messages.filter((message) => message.role === "tool").at(-1);
      assert.equal(JSON.parse(lastToolResult?.content ?? "{}").ok, false);
      assert.ok(result.steps.some((step) => step.name === "get_district_profile" && /неизвестный район/i.test(step.detail)));
    });

    console.log(`Офлайн-проверки агента пройдены: ${passed}. Сетевые вызовы перехвачены.`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
}

main().catch((error: unknown) => {
  console.error(`Офлайн-проверки агента не пройдены: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  process.exitCode = 1;
});
