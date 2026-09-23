"use client";

import { useId, useState } from "react";
import { indicators, rules } from "@/lib/engine/data";
import type { DistrictScore } from "@/lib/engine/score";

type Props = { districts: DistrictScore[]; affectedDistrictIds?: string[] };
const format = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const bar = (value: number) => Math.max(0, Math.min(100, value)) * 2.5;

function Bars({ before, after, label }: { before: number; after: number; label: string }) {
  return (
    <svg viewBox="0 0 340 53" className="block w-full" role="img" aria-label={`${label}: до ${format(before)}, после ${format(after)}. Красная линия — ориентир ${rules.criticalThreshold}.`}>
      <rect x="1" y="7" width="250" height="12" rx="4" fill="#f1f5f9" />
      <rect x="1" y="7" width={bar(before)} height="12" rx="4" fill="#94a3b8" />
      <rect x="1" y="29" width="250" height="12" rx="4" fill="#f1f5f9" />
      <rect x="1" y="29" width={bar(after)} height="12" rx="4" fill={after < before ? "#e11d48" : "#4f46e5"} />
      <line x1={1 + bar(rules.criticalThreshold)} x2={1 + bar(rules.criticalThreshold)} y1="3" y2="46" stroke="#dc2626" strokeWidth="1.5" strokeDasharray="3 3" />
      <text x="265" y="17" fontSize="13" fill="#64748b">{format(before)}</text>
      <text x="265" y="39" fontSize="13" fill={after < rules.criticalThreshold ? "#be123c" : "#312e81"} fontWeight="600">{format(after)}</text>
    </svg>
  );
}

export default function DistrictChart({ districts, affectedDistrictIds = [] }: Props) {
  const [selectedId, setSelectedId] = useState(districts[0]?.id ?? "");
  const selectorId = useId();
  const selected = districts.find((district) => district.id === selectedId) ?? districts[0];
  if (!selected) return null;
  return (
    <section aria-labelledby="district-chart-title" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <h3 id="district-chart-title" className="text-xl font-semibold text-slate-900">Как изменились районы</h3>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
        <span><span className="mr-2 inline-block h-2 w-5 rounded bg-slate-400" />До мер</span>
        <span><span className="mr-2 inline-block h-2 w-5 rounded bg-indigo-600" />После мер</span>
        <span><span className="mr-2 inline-block h-2 w-5 rounded bg-rose-600" />Снижение</span>
        <span className="text-rose-700">Красная линия: ориентир 40</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">Шкала 0–100. Порог 40 определяет критичность отдельных показателей; на индексе D это ориентир. При событии «до» уже учитывает его влияние.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {districts.map((district) => (
          <div key={district.id} className={`min-w-0 rounded-xl border p-4 ${affectedDistrictIds.includes(district.id) ? "border-amber-300 bg-amber-50/50" : "border-slate-100 bg-slate-50/40"}`}>
            <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">{district.name} · D
              {affectedDistrictIds.includes(district.id) && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Событие</span>}
            </p>
            <Bars before={district.D_before} after={district.D_after} label={`${district.name}, индекс D`} />
          </div>
        ))}
      </div>
      <div className="mt-6 border-t border-slate-100 pt-5">
        <label htmlFor={selectorId} className="mr-3 text-sm font-semibold text-slate-800">Показатели района</label>
        <select id={selectorId} value={selected.id} onChange={(event) => setSelectedId(event.target.value)} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 sm:mt-0">
          {districts.map((district) => <option key={district.id} value={district.id}>{district.name}</option>)}
        </select>
        <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
          {indicators.map(({ code, name }) => (
            <div key={code} className="min-w-0">
              <p className="text-xs leading-5 text-slate-600"><strong className="text-slate-900">{code}</strong> {name}</p>
              <Bars before={selected.before[code]} after={selected.after[code]} label={`${selected.name}, ${name}`} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
