"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import AgentReport from "@/components/AgentReport";
import DistrictOverview from "@/components/DistrictOverview";
import MeasurePicker from "@/components/MeasurePicker";
import { districts, measures, rules, type Decision } from "@/lib/engine/data";
import { validate } from "@/lib/engine/validate";
import { agentStepSchema, reportSchema } from "@/lib/agent/schemas";

const responseSchema = z.object({
  calc: z.object({ score: z.number(), baseScore: z.number(), delta: z.number() }),
  report: reportSchema.nullable(),
  steps: z.array(agentStepSchema),
  aiError: z.string().optional(),
});
const errorSchema = z.object({
  error: z.string().optional(),
  errors: z.array(z.string()).optional(),
});
type AnalysisResult = z.infer<typeof responseSchema> & { cost: number };
const formatScore = (value: number) => value.toLocaleString("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function HomePage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result || error) {
      outcomeRef.current?.focus({ preventScroll: true });
      outcomeRef.current?.scrollIntoView({ block: "start" });
    }
  }, [result, error]);

  function changeDecisions(nextDecisions: Decision[]) {
    setDecisions(nextDecisions);
    setResult(null);
    setError(null);
  }

  async function calculate() {
    if (isCalculating || !validate(decisions).ok) return;
    setIsCalculating(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 70_000);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = errorSchema.safeParse(body);
        const message = parsed.success
          ? parsed.data.errors?.join(" ") || parsed.data.error
          : undefined;
        setError(message || "Не удалось рассчитать результат. Попробуйте ещё раз.");
        return;
      }

      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) {
        setError("Сервер вернул некорректный результат. Попробуйте ещё раз.");
        return;
      }
      const cost = decisions.reduce((total, decision) => (
        total + (measures.find((measure) => measure.id === decision.measureId)?.cost ?? 0)
      ), 0);
      setResult({ ...parsed.data, cost });
    } catch {
      setError(controller.signal.aborted
        ? "Расчёт занял слишком много времени. Попробуйте ещё раз."
        : "Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      clearTimeout(timeout);
      setIsCalculating(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="mb-9">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
          <span className="rounded-md bg-indigo-600 px-2 py-1 text-white">Астана</span>
          <span>Симулятор городских решений</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Аким на 5 часов</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
          Выберите {rules.decisionsExactly} мер в пределах бюджета {rules.budget} и узнайте,
          как они повлияют на качество жизни в {districts.length} районах города.
        </p>
      </header>

      <MeasurePicker
        decisions={decisions}
        onChange={changeDecisions}
        onCalculate={calculate}
        isCalculating={isCalculating}
      />

      <div ref={outcomeRef} tabIndex={-1} aria-live="polite" aria-busy={isCalculating} className="scroll-mt-8 focus:outline-none">
        {isCalculating && !result && <p role="status" className="mt-6 text-sm text-slate-600">Агент анализирует…</p>}
        {error && <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
        {result && (
          <section aria-labelledby="result-title" className="mt-8 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-6 sm:p-8">
            <h2 id="result-title" className="text-lg font-semibold">Результат расчёта</h2>
            <dl className="mt-5 grid gap-6 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-slate-600">Score · качество жизни</dt>
                <dd className="mt-1 text-4xl font-bold tabular-nums text-indigo-700">{formatScore(result.calc.score)}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-600">Дельта к базе {formatScore(result.calc.baseScore)}</dt>
                <dd className={`mt-1 text-3xl font-semibold tabular-nums ${result.calc.delta < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                  {result.calc.delta > 0 ? "+" : ""}{formatScore(result.calc.delta)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-600">Стоимость выбранных мер</dt>
                <dd className="mt-1 text-3xl font-semibold tabular-nums">{result.cost} <span className="text-base font-normal text-slate-500">из {rules.budget}</span></dd>
              </div>
            </dl>
          </section>
        )}
        {result && (
          <AgentReport
            report={result.report}
            steps={result.steps}
            aiError={result.aiError}
            isAnalyzing={isCalculating}
            onRetry={calculate}
          />
        )}
      </div>

      <DistrictOverview />
    </main>
  );
}
