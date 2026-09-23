import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatCompletionMessageParam, ChatCompletionToolChoiceOption } from "openai/resources/chat/completions";
import { ZodError } from "zod";
import { createOpenAIClient, OPENAI_MODEL } from "../openai";
import type { Decision } from "../engine/data";
import { getEvent, type ScoreOptions } from "../engine/events";
import { validate } from "../engine/validate";
import { reportWireSchema, type AgentReport, type AgentStep } from "./schemas";
import { agentTools, decisionsInputSchema, dispatchTool, normalizeToolDecisions } from "./tools";
import { correctionPrompt, FINAL_PROMPT, scenarioPrompt, SYSTEM_PROMPT } from "./prompts";
import { validateReport } from "./report-validation";

export type AgentResult = { report: AgentReport | null; steps: AgentStep[]; aiError?: string };
const MAX_TOOL_CALLS = 8;
const TIMEOUT_MS = 60_000;
class AgentError extends Error {}

function readableError(error: unknown, aborted: boolean): string {
  if (aborted || error instanceof OpenAI.APIConnectionTimeoutError) return "AI-анализ не завершился за 60 секунд. Повторите анализ.";
  if (error instanceof AgentError) return error.message;
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) return "OpenAI отклонил доступ. Проверьте API-ключ и права на модель.";
    if (error.status === 429) return "Лимит OpenAI исчерпан. Проверьте квоту или повторите анализ позже.";
    if (error.status === 400 || error.status === 404) return "OpenAI не принял настройки анализа. Проверьте доступность выбранной модели.";
  }
  if (error instanceof OpenAI.APIConnectionError) return "Не удалось подключиться к OpenAI. Повторите анализ позже.";
  return "AI-анализ сейчас недоступен. Повторите попытку позже.";
}

function setKey(decisions: readonly Decision[]): string {
  return JSON.stringify(decisions.map(({ measureId, districtId }) => [measureId, districtId ?? null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export async function runAgent(decisions: readonly Decision[], options: ScoreOptions = {}): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const controller = new AbortController();
  const deadline = Date.now() + TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (!validate(decisions).ok) throw new AgentError("Для AI-анализа нужен корректный набор решений.");
    const activeEvent = getEvent(options.eventId);
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new AgentError("Не задан OPENAI_API_KEY. Добавьте ключ в окружение сервера и повторите анализ.");
    }
    const client = createOpenAIClient();
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: scenarioPrompt(decisions, activeEvent) },
    ];
    const outputs: unknown[] = [];
    const required = ["score_set", "get_contributions", "suggest_swaps"];
    if (activeEvent) required.push("get_active_event");
    let completedRequired = 0;
    let toolCalls = 0;
    let reportRetries = 0;
    steps.push({ name: "start", detail: "Начат анализ выбранного сценария через инструменты движка." });

    while (true) {
      if (controller.signal.aborted) throw new AgentError("Истекло время AI-анализа.");
      const mandatory = required[completedRequired];
      const finalOnly = toolCalls >= MAX_TOOL_CALLS || reportRetries > 0;
      if (finalOnly && mandatory) throw new AgentError("Агент не смог получить обязательные результаты расчёта.");
      const toolChoice: ChatCompletionToolChoiceOption = finalOnly ? "none"
        : mandatory ? { type: "function", function: { name: mandatory } } : "auto";
      const completion = await client.chat.completions.create({
        model: OPENAI_MODEL,
        // These models require non-reasoning mode for Chat Completions tools.
        reasoning_effort: /^gpt-6-(sol|luna)(-|$)/.test(OPENAI_MODEL) ? "none" : undefined,
        messages,
        tools: agentTools,
        tool_choice: toolChoice,
        parallel_tool_calls: false,
        response_format: zodResponseFormat(reportWireSchema, "city_analysis"),
        max_completion_tokens: 2600,
      }, { signal: controller.signal, timeout: Math.max(1, deadline - Date.now()) });
      if (controller.signal.aborted) throw new AgentError("Истекло время AI-анализа.");
      const message = completion.choices[0]?.message;
      if (!message || message.refusal) throw new AgentError("OpenAI не смог подготовить отчёт по этому сценарию.");
      messages.push(message);
      const calls = message.tool_calls ?? [];

      if (calls.length > 0) {
        if (finalOnly || calls.length !== 1) throw new AgentError("Агент нарушил ограничение на вызовы инструментов.");
        const call = calls[0];
        if (call.type !== "function" || (mandatory && call.function.name !== mandatory)) {
          throw new AgentError("Агент не выполнил обязательный порядок анализа.");
        }
        toolCalls += 1;
        let args: unknown;
        let output: unknown;
        let summary: string;
        try {
          args = JSON.parse(call.function.arguments);
          if (mandatory && mandatory !== "get_active_event") {
            const input = decisionsInputSchema.parse(args);
            if (setKey(normalizeToolDecisions(input.decisions)) !== setKey(decisions)) {
              throw new AgentError("Обязательный инструмент должен анализировать исходный набор без изменений.");
            }
          }
          const executed = dispatchTool(call.function.name, args, decisions, options);
          output = executed.output;
          summary = executed.summary;
          const failed = output !== null && typeof output === "object" && "ok" in output && output.ok === false;
          if (!failed) {
            outputs.push(output);
            if (mandatory) completedRequired += 1;
          }
        } catch (error) {
          summary = error instanceof AgentError ? error.message
            : error instanceof ZodError || error instanceof SyntaxError
              ? "Неверные аргументы инструмента: проверьте JSON, идентификаторы и район каждой меры."
              : "Не удалось выполнить инструмент. Проверьте его имя и аргументы.";
          output = { error: summary };
        }
        steps.push({
          name: call.function.name,
          detail: `Аргументы: ${(args === undefined ? call.function.arguments.replace(/\s+/g, " ") : JSON.stringify(args)).slice(0, 1800)}. ${summary}`,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
        if (toolCalls === MAX_TOOL_CALLS) messages.push({ role: "user", content: FINAL_PROMPT });
        continue;
      }

      if (mandatory) throw new AgentError("Агент завершил ответ до обязательных вызовов инструментов.");
      try {
        const report = validateReport(message.content ?? "", outputs);
        steps.push({ name: "report", detail: "Отчёт прошёл проверку структуры, чисел и соответствия рекомендаций рассчитанным заменам." });
        return { report, steps };
      } catch (error) {
        if (reportRetries >= 1) throw new AgentError("Ответ AI повторно не прошёл проверку. Числовой расчёт сохранён; повторите анализ.");
        reportRetries += 1;
        const issue = error instanceof Error ? error.message : "Неверный формат отчёта.";
        steps.push({ name: "retry", detail: `Отчёт не прошёл проверку: ${issue}. Запрошено одно исправление.` });
        messages.push({ role: "user", content: correctionPrompt(issue) });
      }
    }
  } catch (error) {
    const aiError = readableError(error, controller.signal.aborted);
    steps.push({ name: "error", detail: aiError });
    return { report: null, steps, aiError };
  } finally {
    clearTimeout(timer);
  }
}
