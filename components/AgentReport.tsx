"use client";

import type { AgentReport as Report, AgentStep } from "@/lib/agent/schemas";
import type { Suggestion } from "@/lib/result-schema";
import { formatNumber, formatScoreDelta, formatScore } from "@/lib/format";

type AgentReportProps = {
  report: Report | null;
  steps: AgentStep[];
  suggestions: Suggestion[];
  score?: number;
  bestKnownScore?: number;
  aiError?: string;
  isAnalyzing: boolean;
  onRetry: () => void;
  onApply: (suggestion: Suggestion) => void;
};

function shortDetail(detail: string): string {
  let summary = detail;
  if (detail.startsWith("Аргументы:")) {
    const argumentsEnd = detail.lastIndexOf("}. ");
    const sentenceEnd = detail.lastIndexOf(". ");
    summary = argumentsEnd >= 0 ? detail.slice(argumentsEnd + 3)
      : sentenceEnd >= 0 ? detail.slice(sentenceEnd + 2) : "Выполнен вызов инструмента.";
  }
  summary = summary.replace(/\s+/g, " ").trim();
  return summary.length > 300 ? `${summary.slice(0, 297)}…` : summary;
}

type CalculatedRecommendationsProps = {
  suggestions: Suggestion[];
  score: number;
  bestKnownScore: number;
  disabled: boolean;
  onApply: (suggestion: Suggestion) => void;
};

export function CalculatedRecommendations({
  suggestions, score, bestKnownScore, disabled, onApply,
}: CalculatedRecommendationsProps) {
  const canCompare = Number.isFinite(score) && Number.isFinite(bestKnownScore);
  const isOptimal = canCompare && Math.abs(score - bestKnownScore) <= 1e-9;
  const hasNoImprovingSwap = canCompare && score < bestKnownScore - 1e-9;

  return (
    <section aria-labelledby="calculated-recommendations-title" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <h2 id="calculated-recommendations-title" className="text-xl font-semibold text-slate-900">Рекомендации по расчёту</h2>
      {suggestions.length > 0 ? (
        <>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Замены проверены движком и доступны без AI. Каждая рассчитана отдельно относительно текущего набора.
          </p>
          {disabled && <p role="status" className="mt-2 text-sm text-indigo-700">Применить замену можно после завершения текущего анализа.</p>}
          <ul className="mt-5 space-y-3">
            {suggestions.slice(0, 5).map((suggestion) => (
              <li key={`${suggestion.replace}-${suggestion.with}-${suggestion.districtId ?? "city"}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                <p className="font-semibold leading-7 text-slate-900">{suggestion.change}</p>
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-slate-500">Новый Score</dt>
                    <dd className="mt-1 font-semibold tabular-nums text-indigo-700">{formatScore(suggestion.newScore)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Дельта Score</dt>
                    <dd className="mt-1 font-semibold tabular-nums text-emerald-700">{formatScoreDelta(suggestion.delta)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Стоимость набора</dt>
                    <dd className="mt-1 font-semibold tabular-nums text-slate-800">{formatNumber(suggestion.cost)} из 100</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => onApply(suggestion)}
                  disabled={disabled}
                  aria-label={`Применить по расчёту: ${suggestion.change}`}
                  className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Применить
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : isOptimal ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium leading-6 text-emerald-900">
          Это лучший возможный набор из 694 395 допустимых вариантов
        </p>
      ) : hasNoImprovingSwap ? (
        <p className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">
          Заменой одной меры набор не улучшить. Лучший возможный результат — {formatScore(bestKnownScore)}, нажмите «Показать оптимальный набор»
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Улучшений заменой одной меры не найдено.</p>
      )}
    </section>
  );
}

export default function AgentReport({
  report, steps, suggestions, score, bestKnownScore, aiError, isAnalyzing, onRetry, onApply,
}: AgentReportProps) {
  const canCompare = score !== undefined && bestKnownScore !== undefined
    && Number.isFinite(score) && Number.isFinite(bestKnownScore);
  const isOptimal = canCompare && Math.abs(score - bestKnownScore) <= 1e-9;
  const hasNoImprovingSwap = suggestions.length === 0 && canCompare && score < bestKnownScore - 1e-9;
  const recommendations = report?.recommendations ?? [];
  const hasOptimizerConclusion = suggestions.length === 0 && (isOptimal || hasNoImprovingSwap);
  const sections = report ? [
    { title: "Сильные стороны", items: report.strengths, color: "bg-emerald-500" },
    { title: "Риски", items: report.risks, color: "bg-rose-500" },
    { title: "Компромиссы", items: report.tradeoffs, color: "bg-amber-500" },
  ] : [];

  return (
    <section aria-labelledby="agent-report-title" aria-busy={isAnalyzing} className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="agent-report-title" className="text-xl font-semibold text-slate-900">Разбор агента</h2>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">Аналитик акимата</span>
      </div>

      {isAnalyzing ? (
        <div className="mt-5">
          <p role="status" className="text-sm font-medium text-indigo-700">Агент анализирует сценарий…</p>
          <div aria-hidden="true" className="mt-5 space-y-3 motion-safe:animate-pulse">
            <div className="h-4 w-full rounded bg-slate-100" />
            <div className="h-4 w-5/6 rounded bg-slate-100" />
            <div className="h-4 w-2/3 rounded bg-slate-100" />
            <div className="grid gap-4 pt-3 sm:grid-cols-3">
              {[0, 1, 2].map((item) => <div key={item} className="h-24 rounded-xl bg-slate-50" />)}
            </div>
          </div>
        </div>
      ) : (
        <>
          {aiError && (
            <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm leading-6 text-amber-900">{aiError}</p>
              <p className="mt-1 text-sm text-amber-800">Расчёт движка доступен; можно повторить AI-анализ.</p>
              <button
                type="button"
                onClick={onRetry}
                disabled={isAnalyzing}
                className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Повторить анализ
              </button>
            </div>
          )}

          {report && (
            <div className="mt-5 space-y-6 text-sm leading-7 text-slate-700">
              <p className="rounded-xl bg-indigo-50/70 p-5 text-base leading-8 text-slate-800">{report.summary}</p>
              <div className="grid gap-6 lg:grid-cols-3">
                {sections.map(({ title, items, color }) => (
                  <div key={title}>
                    <h3 className="flex items-center gap-2 font-semibold text-slate-900">
                      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${color}`} />{title}
                    </h3>
                    {items.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-2 pl-5 marker:text-slate-300">
                        {items.map((item, index) => <li key={index}>{item}</li>)}
                      </ul>
                    ) : <p className="mt-2 text-slate-500">Агент не отметил.</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(hasOptimizerConclusion || recommendations.length > 0) && (
            <div className="mt-6 border-t border-slate-100 pt-5 text-sm leading-7 text-slate-700">
              <h3 className="text-base font-semibold text-slate-900">Рекомендации</h3>
              {suggestions.length === 0 && isOptimal ? (
                <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium leading-6 text-emerald-900">
                  Это лучший возможный набор из 694 395 допустимых вариантов
                </p>
              ) : hasNoImprovingSwap ? (
                <p className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">
                  Заменой одной меры набор не улучшить. Лучший возможный результат — {formatScore(bestKnownScore)}, нажмите «Показать оптимальный набор»
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {recommendations.map((recommendation, index) => {
                    const suggestion = suggestions.find((item) => item.change === recommendation.change
                      && Number(item.delta.toFixed(2)) === recommendation.expectedDelta);
                    return (
                      <li key={index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="max-w-3xl font-semibold text-slate-900">{recommendation.change}</p>
                          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold tabular-nums ${recommendation.expectedDelta > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                            Score {formatScoreDelta(recommendation.expectedDelta)}
                          </span>
                        </div>
                        <p className="mt-2">{recommendation.why}</p>
                        {suggestion && (
                          <button
                            type="button"
                            onClick={() => onApply(suggestion)}
                            disabled={isAnalyzing}
                            aria-label={`Применить: ${recommendation.change}`}
                            className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Применить
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {!isAnalyzing && steps.length > 0 && (
        <details className="mt-6 border-t border-slate-200 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
            Как агент пришёл к выводу <span className="font-normal text-slate-400">· {steps.length} {steps.length === 1 ? "шаг" : steps.length < 5 ? "шага" : "шагов"}</span>
          </summary>
          <ol className="mt-4 space-y-3 text-sm text-slate-600">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3 break-words leading-6">
                <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{index + 1}</span>
                <div className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-indigo-700">{step.name}</span>
                  <p className="mt-0.5">{shortDetail(step.detail)}</p>
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
