import { districts, indicators, rules } from "@/lib/engine/data";

export default function DistrictOverview() {
  return (
    <section aria-labelledby="districts-title" className="mt-14 border-t border-slate-200 pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="districts-title" className="text-2xl font-semibold tracking-tight">Районы</h2>
          <p className="mt-2 text-sm text-slate-600">Текущие показатели до применения выбранных мер.</p>
        </div>
        <p className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">
          Красным отмечены значения ниже {rules.criticalThreshold}
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {districts.map((district) => (
          <article key={district.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">{district.name}</h3>
              <span className="whitespace-nowrap text-sm text-slate-500">
                {Math.round(district.population * 100)}% населения
              </span>
            </div>
            <p className="mt-2 min-h-10 text-sm leading-5 text-slate-600">{district.profile}</p>
            <dl className="mt-5 divide-y divide-slate-100">
              {indicators.map((indicator) => {
                const value = district.values[indicator.code];
                const isCritical = value < rules.criticalThreshold;
                return (
                  <div key={indicator.code} className="flex items-center justify-between gap-3 py-2">
                    <dt className="flex items-baseline gap-2 text-xs leading-5 text-slate-600">
                      <span className="shrink-0 font-mono text-slate-400">{indicator.code}</span>
                      {indicator.name}
                    </dt>
                    <dd className={`min-w-8 rounded-md px-1.5 py-0.5 text-right text-sm font-semibold tabular-nums ${
                      isCritical ? "bg-rose-50 text-rose-700" : "text-slate-800"
                    }`}>
                      {value}
                      {isCritical && <span className="sr-only"> — ниже критического порога</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
