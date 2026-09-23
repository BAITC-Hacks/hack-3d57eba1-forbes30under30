import type { ScoreResult } from "@/lib/engine/score";

type ScoreCardProps = {
  calc: ScoreResult;
  cost: number;
  bestKnownScore: number;
  onShowOptimal: () => void;
  disabled: boolean;
};

const number = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const signed = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

export default function ScoreCard({
  calc, cost, bestKnownScore, onShowOptimal, disabled,
}: ScoreCardProps) {
  const weakest = calc.districts.reduce((current, district) => (
    district.D_after < current.D_after ? district : current
  ));
  const deltaColor = calc.delta > 0
    ? "bg-emerald-50 text-emerald-800"
    : calc.delta < 0 ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-700";

  return (
    <section aria-labelledby="score-card-title" className="min-w-0 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
      <h3 id="score-card-title" className="text-sm font-semibold uppercase tracking-wider text-indigo-700">
        Качество жизни · Score
      </h3>
      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <p className="text-6xl font-semibold tracking-tight text-slate-950 tabular-nums sm:text-7xl">
          {number.format(calc.score)}
        </p>
        <p className={`mb-1 rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums ${deltaColor}`}>
          {signed.format(calc.delta)} к базе {number.format(calc.baseScore)}
        </p>
      </div>

      <dl className="mt-7 grid grid-cols-2 gap-x-5 gap-y-5 border-t border-slate-100 pt-5">
        <div>
          <dt className="text-sm text-slate-500">Стоимость</dt>
          <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{cost} <span className="text-sm font-normal text-slate-500">из 100</span></dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Средний индекс · D_avg</dt>
          <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{number.format(calc.dAvg)}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Самый слабый район</dt>
          <dd className="mt-1 font-semibold text-slate-900">
            {weakest.name} <span className="whitespace-nowrap tabular-nums">· {number.format(weakest.D_after)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">Критических значений &lt; 40</dt>
          <dd className={`mt-1 text-xl font-semibold tabular-nums ${calc.criticals.length > 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {calc.criticals.length}
          </dd>
        </div>
      </dl>

      <div className="mt-6 rounded-xl bg-indigo-50 p-4">
        <p className="text-sm font-semibold text-indigo-950">
          Лучший возможный: <span className="tabular-nums">{number.format(bestKnownScore)}</span>
        </p>
        <button
          type="button"
          onClick={onShowOptimal}
          disabled={disabled}
          className="mt-3 min-h-11 w-full rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-50"
        >
          Показать оптимальный набор
        </button>
      </div>
    </section>
  );
}
