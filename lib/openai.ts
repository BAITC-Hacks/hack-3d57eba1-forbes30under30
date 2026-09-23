import OpenAI from "openai";
import type { ChatCompletionCreateParams } from "openai/resources/chat/completions";

export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-6-sol";
const models = [...new Set([OPENAI_MODEL, "gpt-6-sol", "gpt-5.6-terra", "gpt-4.1"])];
let activeModel = OPENAI_MODEL;
let lastRequestUnavailable = false;

export const getActiveModel = (): string => activeModel;
// The smoke script needs this distinction because runAgent returns safe text,
// not the upstream error. A successful request resets it before report validation.
export const wasLastAIRequestUnavailable = (): boolean => lastRequestUnavailable;

function isModelUnavailable(status: number, error: unknown, model: string): boolean {
  if (![400, 403, 404].includes(status) || !error || typeof error !== "object") return false;
  const { code, param, message } = error as { code?: unknown; param?: unknown; message?: unknown };
  if (code === "model_not_found") return true;
  const text = typeof message === "string" ? message : "";
  const specificModel = param === "model" || (/\bmodel\b/i.test(text) && text.includes(model));
  return specificModel && (status === 404 || /(?:not found|does not exist|not have access|no access|access[^.]*denied|not allowed|not authorized|permission|unavailable)/i.test(text));
}

const fetchWithModelFallback: typeof fetch = async (url, options) => {
  if (!String(url).endsWith("/chat/completions") || typeof options?.body !== "string") {
    return fetch(url, options);
  }
  const body = JSON.parse(options.body) as ChatCompletionCreateParams;
  lastRequestUnavailable = false;
  const candidates = models.slice(models.indexOf(activeModel));
  for (const [index, model] of candidates.entries()) {
    let response: Response;
    try {
      options.signal?.throwIfAborted();
      response = await fetch(url, {
        ...options,
        body: JSON.stringify({
          ...body, model,
          reasoning_effort: /^gpt-6-(sol|luna)(-|$)/.test(model) ? "none" : undefined,
        }),
      });
    } catch (error) {
      lastRequestUnavailable = true;
      throw error;
    }
    if (response.ok) {
      activeModel = model;
      lastRequestUnavailable = false;
      return response;
    }
    const payload: unknown = await response.clone().json().catch(() => null);
    const modelUnavailable = isModelUnavailable(response.status,
      payload && typeof payload === "object" && "error" in payload ? payload.error : null, model);
    lastRequestUnavailable = modelUnavailable || [401, 403, 408, 429].includes(response.status) || response.status >= 500;
    if (!modelUnavailable || index === candidates.length - 1 || options.signal?.aborted) return response;
    await response.body?.cancel();
  }
  throw new Error("Не удалось выбрать модель OpenAI.");
};

// Create on demand so the app and deterministic engine work without an API key.
export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Не задан OPENAI_API_KEY. Укажите ключ в переменных окружения для AI-анализа.");
  }

  try {
    return new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0, fetch: fetchWithModelFallback });
  } catch {
    throw new Error("Не удалось создать клиент OpenAI. Проверьте настройки окружения.");
  }
}
