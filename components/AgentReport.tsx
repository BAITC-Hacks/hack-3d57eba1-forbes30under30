import type { AgentReport as Report, AgentStep } from "@/lib/agent/schemas";

type AgentReportProps = {
  report: Report | null;
  steps: AgentStep[];
  aiError?: string;
  isAnalyzing: boolean;
  onRetry: () => void;
};

export default function AgentReport({ report, steps, aiError, isAnalyzing, onRetry }: AgentReportProps) {
  const sections = report ? [
    { title: "Сильные стороны", items: report.strengths },
    { title: "Риски", items: report.risks },
    { title: "Компромиссы", items: report.tradeoffs },
  ] : [];

  return (
    <section aria-labelledby="agent-report-title" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <h2 id="agent-report-title" className="text-lg font-semibold">Разбор агента</h2>
      {isAnalyzing && <p role="status" className="mt-3 text-sm text-indigo-700">Агент анализирует…</p>}

      {aiError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm leading-6 text-amber-900">{aiError}</p>
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
        <div className="mt-4 space-y-5 text-sm leading-7 text-slate-700">
          <p>{report.summary}</p>
          {sections.map(({ title, items }) => (
            <div key={title}>
              <h3 className="font-semibold text-slate-900">{title}</h3>
              {items.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {items.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              ) : <p className="mt-1 text-slate-500">Агент не отметил.</p>}
            </div>
          ))}
          <div>
            <h3 className="font-semibold text-slate-900">Рекомендации</h3>
            {report.recommendations.length > 0 ? (
              <ul className="mt-2 space-y-3">
                {report.recommendations.map((recommendation, index) => (
                  <li key={index} className="rounded-lg bg-slate-50 p-4">
                    <p className="font-medium text-slate-900">{recommendation.change}</p>
                    {recommendation.expectedDelta !== undefined && (
                      <p className="mt-1 text-slate-600">
                        Ожидаемая дельта Score: {recommendation.expectedDelta > 0 ? "+" : ""}
                        {recommendation.expectedDelta.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    )}
                    <p className="mt-1">{recommendation.why}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-slate-500">Дополнительных рекомендаций нет.</p>}
          </div>
        </div>
      )}

      {steps.length > 0 && (
        <details className="mt-6 border-t border-slate-200 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
            Шаги агента ({steps.length})
          </summary>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-slate-600">
            {steps.map((step, index) => (
              <li key={index} className="break-words leading-6">
                <span className="font-semibold text-slate-800">{step.name}</span>
                <p className="mt-0.5 whitespace-pre-wrap">{step.detail}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
