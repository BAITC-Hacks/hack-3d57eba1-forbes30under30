"use client";

import { useEffect, useRef, useState } from "react";
import AgentReport, { CalculatedRecommendations } from "@/components/AgentReport";
import Contributions from "@/components/Contributions";
import DistrictOverview from "@/components/DistrictOverview";
import DistrictTable from "@/components/DistrictTable";
import DistrictChart from "@/components/DistrictChart";
import EventPicker from "@/components/EventPicker";
import ReportDownload from "@/components/ReportDownload";
import MeasurePicker from "@/components/MeasurePicker";
import Scenarios from "@/components/Scenarios";
import ScoreCard from "@/components/ScoreCard";
import { rules, type Decision } from "@/lib/engine/data";
import { validate } from "@/lib/engine/validate";
import { calculationSchema, agentAnalysisSchema, apiErrorSchema, type Analysis, type Suggestion } from "@/lib/result-schema";
import { applySuggestion } from "@/lib/suggestions";
import type { SavedScenario } from "@/lib/scenarios/schema";
import { formatNumber } from "@/lib/format";

type Result = Analysis & { decisions: Decision[] };

function apiMessage(body: unknown, fallback: string): string {
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error || parsed.data.errors?.join(" ") || fallback : fallback;
}

export default function HomePage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [eventId, setEventId] = useState<string>();
  const [scenarioName, setScenarioName] = useState("");
  const [isCalculating, setIsCalculating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const isBusy = isCalculating || isAnalyzing;

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (result || error) {
      outcomeRef.current?.focus({ preventScroll: true });
      outcomeRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  // Receiving the later AI response must not scroll away from the table or chart.
  }, [result?.calc, error]);

  function changeDecisions(nextDecisions: Decision[]) {
    if (busyRef.current) return;
    setDecisions(nextDecisions);
    setResult(null);
    setError(null);
  }

  async function calculate(
    nextDecisions: readonly Decision[] = decisions,
    options: { eventId?: string } = { eventId },
  ) {
    if (busyRef.current) return;
    const validation = validate(nextDecisions);
    if (!validation.ok) {
      setError(validation.errors.join(" "));
      return;
    }
    const snapshot = nextDecisions.map((decision) => ({ ...decision }));
    busyRef.current = true;
    setDecisions(snapshot);
    setEventId(options.eventId);
    setIsCalculating(true);
    setResult(null);
    setError(null);
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("/api/calc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: snapshot, eventId: options.eventId }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(apiMessage(body, "Не удалось рассчитать сценарий. Попробуйте ещё раз."));
        return;
      }
      const parsed = calculationSchema.safeParse(body);
      if (!parsed.success) {
        setError("Сервер вернул некорректный результат. Попробуйте ещё раз.");
        return;
      }
      const calculated: Result = { ...parsed.data, decisions: snapshot, report: null, steps: [] };
      // Publish engine results before waiting on any OpenAI request.
      setResult(calculated);
      clearTimeout(timeout);
      setIsCalculating(false);
      setIsAnalyzing(true);
      await analyze(calculated, controller);
    } catch {
      setError(controller.signal.aborted
        ? "Расчёт занял слишком много времени. Попробуйте ещё раз."
        : "Не удалось получить ответ сервера. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      clearTimeout(timeout);
      requestRef.current = null;
      busyRef.current = false;
      setIsCalculating(false);
      setIsAnalyzing(false);
    }
  }

  async function analyze(calculated: Result, controller: AbortController) {
    const timeout = setTimeout(() => controller.abort(), 70_000);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: calculated.decisions, eventId: calculated.eventId }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setResult({ ...calculated, report: null, steps: [], aiError: apiMessage(body, "Не удалось получить разбор агента. Попробуйте ещё раз.") });
        return;
      }
      const parsed = agentAnalysisSchema.safeParse(body);
      if (!parsed.success) {
        setResult({ ...calculated, report: null, steps: [], aiError: "Агент вернул некорректный ответ. Числовой расчёт сохранён. Повторите анализ." });
        return;
      }
      setResult({ ...calculated, ...parsed.data });
    } catch {
      setResult({ ...calculated, report: null, steps: [], aiError: controller.signal.aborted
        ? "Агент не ответил вовремя. Числовой расчёт сохранён. Повторите анализ."
        : "Не удалось связаться с агентом. Числовой расчёт сохранён. Повторите анализ." });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function retryAnalysis() {
    if (busyRef.current || !result) return;
    busyRef.current = true;
    const calculated = { ...result, report: null, steps: [], aiError: undefined };
    setResult(calculated);
    setIsAnalyzing(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      await analyze(calculated, controller);
    } finally {
      requestRef.current = null;
      busyRef.current = false;
      setIsAnalyzing(false);
    }
  }

  function changeEvent(nextEventId?: string) {
    if (busyRef.current) return;
    setEventId(nextEventId);
    setResult(null);
    setError(null);
    if (validate(decisions).ok) void calculate(decisions, { eventId: nextEventId });
  }

  function apply(suggestion: Suggestion) {
    if (!result || !result.suggestions.some((item) => item.change === suggestion.change
      && item.delta === suggestion.delta)) return;
    void calculate(applySuggestion(result.decisions, suggestion), { eventId: result.eventId });
  }

  function loadScenario(scenario: SavedScenario) {
    if (busyRef.current) return;
    setScenarioName(scenario.name);
    void calculate(scenario.decisions, { eventId: scenario.eventId });
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="mb-10 max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
          <span className="rounded-md bg-indigo-600 px-2 py-1 text-white">Астана</span>
          <span>От решений — к качеству жизни</span>
        </div>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Аким на 5 часов — AI-симулятор управления городом
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
          Бюджет {formatNumber(rules.budget)}, всего {rules.decisionsExactly} решений. Выберите меры и районы,
          сравните результат и узнайте, какие изменения принесут городу больше пользы.
        </p>
      </header>

      <MeasurePicker decisions={decisions} onChange={changeDecisions}
        onCalculate={() => void calculate()} isBusy={isBusy} isAnalyzing={isAnalyzing} />

      <div ref={outcomeRef} tabIndex={-1} aria-busy={isCalculating} className="scroll-mt-6 focus:outline-none">
        <EventPicker eventId={eventId} onChange={changeEvent} disabled={isBusy}
          beforeScore={result?.scoreBeforeEvent} afterScore={result?.calc.score} />
        {error && (
          <div role="alert" className="mt-8 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
            <p>{error}</p>
            <button type="button" onClick={() => void calculate(decisions, { eventId })}
              disabled={isBusy} className="mt-3 rounded-lg border border-rose-300 px-4 py-2 font-semibold hover:bg-rose-100 disabled:opacity-50">
              Повторить расчёт
            </button>
          </div>
        )}
        {(result || isCalculating) && (
          <section className="mt-10" aria-labelledby="outcome-title">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 id="outcome-title" className="text-2xl font-bold tracking-tight">Результат сценария</h2>
              {result && <ReportDownload name={scenarioName} decisions={result.decisions} calc={result.calc}
                cost={result.cost} report={result.report} activeEvent={result.activeEvent} disabled={isBusy} />}
            </div>
            {result ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <ScoreCard calc={result.calc} cost={result.cost} bestKnownScore={result.bestKnownScore}
                  onShowOptimal={() => void calculate(result.optimalDecisions, { eventId: result.eventId })} disabled={isBusy} />
                <Contributions contributions={result.calc.contributions} />
              </div>
            ) : (
              <div>
                <p role="status" className="mb-4 text-sm text-indigo-700">Рассчитываем показатели сценария…</p>
                <div aria-hidden="true" className="grid gap-5 lg:grid-cols-2">
                  {[0, 1].map((item) => (
                    <div key={item} className="h-72 rounded-2xl border border-slate-200 bg-white p-6 motion-safe:animate-pulse">
                      <div className="h-4 w-1/3 rounded bg-slate-100" />
                      <div className="mt-6 h-14 w-1/2 rounded bg-slate-100" />
                      <div className="mt-8 h-20 rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result && <DistrictChart districts={result.calc.districts} affectedDistrictIds={Object.keys(result.activeEvent?.effects ?? {})} />}
            {result && <AgentReport report={result.report} steps={result.steps}
              suggestions={result.suggestions} aiError={result.aiError}
              isAnalyzing={isAnalyzing} onRetry={() => void retryAnalysis()} onApply={apply} />}
            {result && <CalculatedRecommendations suggestions={result.suggestions}
              score={result.calc.score} bestKnownScore={result.bestKnownScore} disabled={isBusy} onApply={apply} />}
            {result && <div className="mt-6"><DistrictTable districts={result.calc.districts}
              affectedDistrictIds={Object.keys(result.activeEvent?.effects ?? {})} /></div>}
          </section>
        )}
      </div>

      {!result && !isBusy && <DistrictOverview />}
      <Scenarios decisions={result?.decisions ?? null} eventId={result?.eventId} name={scenarioName}
        onNameChange={setScenarioName} isCalculating={isBusy} onLoad={loadScenario} />
    </main>
  );
}
