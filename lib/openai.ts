import OpenAI from "openai";

export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";

// Create on demand so the app and deterministic engine work without an API key.
export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Не задан OPENAI_API_KEY. Укажите ключ в переменных окружения для AI-анализа.");
  }

  try {
    return new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
  } catch {
    throw new Error("Не удалось создать клиент OpenAI. Проверьте настройки окружения.");
  }
}
