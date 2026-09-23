import { districts, measures } from "@/lib/engine/data";
import type { Contribution } from "@/lib/engine/score";
import { formatScoreDelta } from "@/lib/format";

type ContributionsProps = { contributions: Contribution[] };

export default function Contributions({ contributions }: ContributionsProps) {
  const maximum = Math.max(...contributions.map(({ contribution }) => Math.abs(contribution)), 0.01);

  return (
    <section aria-labelledby="contributions-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 id="contributions-title" className="text-xl font-semibold text-slate-950">Вклад решений в Score</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Разница между Score полного набора и Score без каждой меры. Из-за синергий и штрафов вклады не складываются в общую дельту.
      </p>
      <div aria-hidden="true" className="mt-5 grid grid-cols-3 text-xs text-slate-500">
        <span>Снижение</span><span className="text-center">0,00</span><span className="text-right">Рост</span>
      </div>
      <ul className="mt-3 space-y-5">
        {contributions.map(({ measureId, districtId, contribution }) => {
          const measure = measures.find(({ id }) => id === measureId);
          const district = districts.find(({ id }) => id === districtId);
          const width = Math.abs(contribution) / maximum * 50;
          return (
            <li key={measureId}>
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 leading-5 text-slate-700">
                  <span className="font-semibold text-slate-950">{measureId}</span> {measure?.name ?? "Мера"}
                  <span className="text-slate-500"> / {district?.name ?? "Весь город"}</span>
                </span>
                <span className={`shrink-0 font-semibold tabular-nums ${contribution > 0 ? "text-emerald-700" : contribution < 0 ? "text-rose-700" : "text-slate-500"}`}>
                  {formatScoreDelta(contribution)}
                </span>
              </div>
              <div aria-hidden="true" className="relative mt-2 h-3 rounded-full bg-slate-100">
                <div
                  className={`absolute top-0 h-3 rounded-full ${contribution < 0 ? "bg-rose-400" : "bg-emerald-500"}`}
                  style={{ width: `${width}%`, left: `${contribution < 0 ? 50 - width : 50}%` }}
                />
                <div className="absolute bottom-[-3px] left-1/2 top-[-3px] w-px bg-slate-400" />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
