import { indicators } from "@/lib/engine/data";
import type { DistrictScore } from "@/lib/engine/score";
import { formatNumber, formatScore } from "@/lib/format";

type DistrictTableProps = { districts: DistrictScore[]; affectedDistrictIds?: string[] };

function Change({ before, after, format = formatNumber }: {
  before: number; after: number; format?: (value: number) => string;
}) {
  const color = after > before ? "text-emerald-700" : after < before ? "text-rose-700" : "text-slate-700";
  const description = after > before ? "рост" : after < before ? "снижение" : "без изменений";
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
      <span className={`rounded px-1 py-0.5 ${before < 40 ? "bg-rose-100 font-medium text-rose-800" : "text-slate-500"}`}>
        <span className="sr-only">До: </span>{format(before)}
      </span>
      <span aria-hidden="true" className="text-slate-400">→</span>
      <span className={`rounded px-1 py-0.5 font-semibold ${color} ${after < 40 ? "bg-rose-100" : ""}`}>
        <span className="sr-only">После: </span>{format(after)}
      </span>
      <span className="sr-only">, {description}</span>
    </span>
  );
}

export default function DistrictTable({ districts, affectedDistrictIds = [] }: DistrictTableProps) {
  return (
    <section aria-labelledby="district-table-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-5 sm:p-6">
        <h3 id="district-table-title" className="text-xl font-semibold text-slate-950">Показатели районов</h3>
        <p id="district-table-help" className="mt-2 text-sm leading-6 text-slate-600">
          До → после. Зелёный — рост, красный — снижение. Красный фон отмечает значения ниже 40.
          Названия показателей доступны при наведении или фокусе на заголовке.
          {affectedDistrictIds.length > 0 && " Исходные значения уже учитывают событие; затронутый район отмечен жёлтым."}
        </p>
      </div>
      <div
        role="region"
        aria-label="Таблица показателей районов, прокручивается по горизонтали"
        aria-describedby="district-table-help"
        tabIndex={0}
        className="relative overflow-x-auto rounded-b-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        <table className="w-full min-w-[1320px] border-collapse text-left text-sm">
          <caption className="sr-only">Показатели пяти районов до и после применения решений, включая итоговый индекс D</caption>
          <thead className="border-y border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-slate-50 px-3 py-4 font-semibold sm:px-5">Район</th>
              {indicators.map((indicator) => (
                <th key={indicator.code} scope="col" className="px-2 py-4 text-center font-semibold">
                  <span
                    tabIndex={0}
                    title={indicator.name}
                    aria-label={`${indicator.code}: ${indicator.name}`}
                    className="group relative inline-block cursor-help rounded border-b border-dotted border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
                  >
                    {indicator.code}
                    <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-44 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-5 text-white shadow-lg group-hover:block group-focus:block">
                      {indicator.name}
                    </span>
                  </span>
                </th>
              ))}
              <th scope="col" className="sticky right-0 z-20 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-2 py-4 text-center font-semibold sm:px-4" title="Взвешенный индекс качества жизни района">Индекс района D</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {districts.map((district) => (
              <tr key={district.id}>
                <th scope="row" className={`sticky left-0 z-10 whitespace-nowrap px-3 py-5 font-semibold text-slate-900 sm:px-5 ${affectedDistrictIds.includes(district.id) ? "bg-amber-50" : "bg-white"}`}>
                  {district.name}
                  {affectedDistrictIds.includes(district.id) && <span className="mt-1 block text-xs font-medium text-amber-800">Событие</span>}
                </th>
                {indicators.map(({ code }) => (
                  <td key={code} className="px-2 py-5 text-center">
                    <Change before={district.before[code]} after={district.after[code]} />
                  </td>
                ))}
                <td className="sticky right-0 z-10 border-l border-slate-200 bg-indigo-50 px-2 py-5 text-center sm:px-4">
                  <Change before={district.D_before} after={district.D_after} format={formatScore} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
