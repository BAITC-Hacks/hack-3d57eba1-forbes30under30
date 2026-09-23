"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { Decision } from "@/lib/engine/data";
import { formatNumber } from "@/lib/format";
import { events } from "@/lib/engine/events";
import { savedScenarioSchema, type SavedScenario } from "@/lib/scenarios/schema";

type ScenariosProps = {
  decisions: Decision[] | null;
  eventId?: string;
  name: string;
  onNameChange: (name: string) => void;
  isCalculating: boolean;
  onLoad: (scenario: SavedScenario) => void;
};

const listSchema = z.array(savedScenarioSchema);
const errorSchema = z.object({ error: z.string().optional(), errors: z.array(z.string()).optional() });
function serverMessage(body: unknown, fallback: string): string {
  const parsed = errorSchema.safeParse(body);
  return parsed.success ? parsed.data.error || parsed.data.errors?.join(" ") || fallback : fallback;
}

export default function Scenarios({ decisions, eventId, name, onNameChange, isCalculating, onLoad }: ScenariosProps) {
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const loadSequence = useRef(0);

  const loadScenarios = useCallback(async () => {
    const sequence = ++loadSequence.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/scenarios", { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(serverMessage(body, "Не удалось загрузить сценарии."));
      const parsed = listSchema.safeParse(body);
      if (!parsed.success) throw new Error("Сервер вернул некорректный список сценариев.");
      if (sequence === loadSequence.current) setScenarios(parsed.data);
    } catch (error) {
      if (sequence === loadSequence.current) {
        setLoadError(controller.signal.aborted
          ? "Загрузка сценариев заняла слишком много времени. Повторите попытку."
          : error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError)
            ? error.message : "Не удалось связаться с сервером сценариев. Повторите попытку.");
      }
    } finally {
      clearTimeout(timeout);
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScenarios();
    return () => {
      loadSequence.current += 1;
      loadController.current?.abort();
      saveController.current?.abort();
    };
  }, [loadScenarios]);

  useEffect(() => {
    setSaveError(null);
    setSavedMessage(null);
  }, [decisions, eventId]);

  async function saveScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decisions || isCalculating || isSaving || !name.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    // An older GET must not replace the list after a successful save.
    loadSequence.current += 1;
    loadController.current?.abort();
    setIsLoading(false);
    const controller = new AbortController();
    saveController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), decisions, eventId }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(serverMessage(body, "Не удалось сохранить сценарий."));
      const parsed = savedScenarioSchema.safeParse(body);
      if (!parsed.success) throw new Error("Сервер не подтвердил сохранение сценария. Обновите список перед повторной попыткой.");
      setScenarios((current) => [...current, parsed.data].sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt)));
      setSavedMessage(`Сценарий «${parsed.data.name}» сохранён.`);
      void loadScenarios();
    } catch (error) {
      setSaveError(controller.signal.aborted
        ? "Сервер не ответил вовремя. Обновите список перед повторным сохранением."
        : error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError)
          ? error.message : "Не удалось связаться с сервером. Обновите список перед повторным сохранением.");
    } finally {
      clearTimeout(timeout);
      setIsSaving(false);
    }
  }

  return (
    <section aria-labelledby="scenarios-title" className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="scenarios-title" className="text-xl font-semibold text-slate-900">Сценарии</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Сохраните результат команды и сравните его с другими планами развития.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadScenarios()}
          disabled={isLoading || isSaving}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Загрузка…" : "Обновить список"}
        </button>
      </div>

      <form onSubmit={(event) => void saveScenario(event)} className="mt-6 rounded-xl bg-slate-50 p-4 sm:p-5">
        <label htmlFor="scenario-name" className="block text-sm font-semibold text-slate-800">Название команды/сценария</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="scenario-name"
            name="scenarioName"
            type="text"
            value={name}
            onChange={(event) => { onNameChange(event.target.value); setSaveError(null); setSavedMessage(null); }}
            maxLength={100}
            placeholder="Например, Зелёная Астана"
            disabled={isSaving}
            aria-describedby="scenario-save-hint"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!decisions || !name.trim() || isCalculating || isSaving}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {isSaving ? "Сохранение…" : "Сохранить сценарий"}
          </button>
        </div>
        <p id="scenario-save-hint" className="mt-2 text-xs leading-5 text-slate-500">
          {decisions ? "Сохранится набор решений из текущего расчёта." : "Рассчитайте выбранные решения, чтобы сохранить сценарий."}
        </p>
        {saveError && <p role="alert" className="mt-3 text-sm leading-6 text-rose-700">{saveError}</p>}
        {savedMessage && <p role="status" className="mt-3 text-sm leading-6 text-emerald-700">{savedMessage}</p>}
      </form>

      {loadError && <p role="alert" className="mt-5 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">{loadError} Нажмите «Обновить список».</p>}
      {isLoading && scenarios.length === 0 ? (
        <p role="status" className="mt-6 text-sm text-slate-500">Загружаем сохранённые сценарии…</p>
      ) : scenarios.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-200 px-5 py-8 text-center text-sm text-slate-500">
          {loadError ? "Список сценариев пока недоступен." : "Пока нет сохранённых сценариев. Ваш план может стать первым."}
        </p>
      ) : (
        <div className="relative mt-6 overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-sm">
            <caption className="sr-only">Сохранённые сценарии по убыванию Score</caption>
            <thead className="border-b border-slate-200 text-xs font-semibold text-slate-500">
              <tr>
                <th scope="col" className="pb-3 pr-4">Место</th>
                <th scope="col" className="pb-3 pr-4">Название</th>
                <th scope="col" className="pb-3 pr-4 text-right">Score</th>
                <th scope="col" className="pb-3 pr-4 text-right">Стоимость</th>
                <th scope="col" className="pb-3 text-right"><span className="sr-only">Просмотр</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scenarios.map((scenario, index) => (
                <tr key={`${scenario.createdAt}-${index}`}>
                  <td className="py-4 pr-4"><span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${index === 0 ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>{index + 1}</span></td>
                  <th scope="row" className="max-w-xs break-words py-4 pr-4 font-medium text-slate-800">
                    {scenario.name}
                    {scenario.eventId && <span className="mt-1 block text-xs font-normal text-amber-800">{events.find((event) => event.id === scenario.eventId)?.title}</span>}
                  </th>
                  <td className="py-4 pr-4 text-right font-semibold tabular-nums text-indigo-700">{formatNumber(scenario.score)}</td>
                  <td className="py-4 pr-4 text-right tabular-nums text-slate-600">{formatNumber(scenario.cost)} <span className="text-xs text-slate-400">/ {formatNumber(100)}</span></td>
                  <td className="py-4 text-right">
                    <button
                      type="button"
                      onClick={() => onLoad(scenario)}
                      disabled={isCalculating || isSaving}
                      aria-label={`Загрузить сценарий «${scenario.name}»`}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Загрузить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
