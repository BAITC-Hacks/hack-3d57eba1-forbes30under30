"use client";

import { districts, indicators } from "@/lib/engine/data";
import { events } from "@/lib/engine/events";

type Props = {
  eventId?: string;
  onChange: (eventId?: string) => void;
  disabled: boolean;
  beforeScore?: number;
  afterScore?: number;
};
const format = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function EventPicker({ eventId, onChange, disabled, beforeScore, afterScore }: Props) {
  const event = events.find((item) => item.id === eventId);
  function randomEvent() {
    const alternatives = events.filter((item) => item.id !== eventId);
    onChange(alternatives[Math.floor(Math.random() * alternatives.length)].id);
  }
  return (
    <section aria-labelledby="event-title" className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/50 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="event-title" className="text-xl font-semibold text-slate-900">Неожиданное событие</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Проверьте, выдержит ли ваш план изменение условий в городе.</p>
        </div>
        <button type="button" onClick={randomEvent} disabled={disabled}
          className="rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600 disabled:opacity-50">
          Случайное событие
        </button>
      </div>
      <label htmlFor="active-event" className="mb-2 mt-5 block text-sm font-medium text-slate-700">Выберите событие</label>
      <div className="flex flex-wrap gap-3">
        <select id="active-event" value={eventId ?? ""} disabled={disabled} onChange={(change) => onChange(change.target.value || undefined)}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50">
          <option value="">Без события</option>
          {events.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        {event && <button type="button" onClick={() => onChange(undefined)} disabled={disabled}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white disabled:opacity-50">Убрать событие</button>}
      </div>
      {event && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-white p-4 sm:p-5" aria-live="polite">
          <h3 className="font-semibold text-amber-950">{event.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{event.description}</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-rose-800">
            {Object.entries(event.effects).flatMap(([districtId, effects]) => Object.entries(effects).map(([code, delta]) => (
              <li key={`${districtId}-${code}`} title={indicators.find((item) => item.code === code)?.name} className="rounded-md bg-rose-50 px-2 py-1">
                {districts.find((item) => item.id === districtId)?.name}: {code} {delta > 0 ? "+" : ""}{delta}
              </li>
            )))}
          </ul>
          {beforeScore !== undefined && afterScore !== undefined ? (
            <p className="mt-4 text-sm font-medium text-slate-800">Score вашего набора до события → после: <strong className="tabular-nums">{format(beforeScore)} → {format(afterScore)}</strong></p>
          ) : <p className="mt-4 text-sm text-slate-500">{disabled ? "Пересчитываем результат с учётом события…" : "Выберите 5 допустимых решений, чтобы увидеть влияние события на ваш набор."}</p>}
          <p className="mt-3 font-semibold text-amber-900">Перераспределите бюджет</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">Сравните рекомендации агента и направьте меры в пострадавший район.</p>
        </div>
      )}
    </section>
  );
}
