"use client";

import {
  directions,
  districts,
  indicators,
  measures,
  referenceValues,
  rules,
  type Decision,
} from "@/lib/engine/data";
import { validate } from "@/lib/engine/validate";

type MeasurePickerProps = {
  decisions: Decision[];
  onChange: (decisions: Decision[]) => void;
  onCalculate: () => void;
  isCalculating: boolean;
};

export default function MeasurePicker({
  decisions,
  onChange,
  onCalculate,
  isCalculating,
}: MeasurePickerProps) {
  const validation = validate(decisions);
  const used = decisions.reduce(
    (total, decision) => total + (measures.find((measure) => measure.id === decision.measureId)?.cost ?? 0),
    0,
  );
  const remaining = rules.budget - used;
  const overBudget = used > rules.budget;
  const progress = Math.min(100, (used / rules.budget) * 100);

  function toggleMeasure(measureId: string, checked: boolean) {
    onChange(checked
      ? [...decisions, { measureId }]
      : decisions.filter((decision) => decision.measureId !== measureId));
  }

  function selectDistrict(measureId: string, districtId: string) {
    onChange(decisions.map((decision) => decision.measureId === measureId
      ? { measureId, ...(districtId ? { districtId } : {}) }
      : decision));
  }

  function loadExample() {
    onChange(referenceValues.exampleSet.decisions.map(([measureId, districtId]) => ({
      measureId,
      ...(districtId === null ? {} : { districtId }),
    })));
  }

  return (
    <form
      className="space-y-6"
      aria-label="Выбор решений"
      onSubmit={(event) => {
        event.preventDefault();
        if (validation.ok && !isCalculating) onCalculate();
      }}
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="budget-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="budget-heading" className="text-lg font-semibold text-slate-900">Ваш план развития</h2>
            <p className={`mt-2 text-sm font-medium sm:text-base ${overBudget ? "text-rose-700" : "text-slate-700"}`}>
              Бюджет {rules.budget} · Использовано {used} · Остаток {remaining}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${decisions.length > rules.decisionsExactly ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
            Выбрано {decisions.length} из {rules.decisionsExactly}
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Использование бюджета"
          aria-valuemin={0}
          aria-valuemax={rules.budget}
          aria-valuenow={Math.min(used, rules.budget)}
          aria-valuetext={`Использовано ${used} из ${rules.budget}, остаток ${remaining}`}
          className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"
        >
          <div className={`h-full rounded-full transition-[width] ${overBudget ? "bg-rose-500" : "bg-indigo-600"}`} style={{ width: `${progress}%` }} />
        </div>

        <p className="mb-2 mt-5 text-sm text-slate-500">Не более {rules.maxPerDirection} мер каждого направления</p>
        <ul className="flex flex-wrap gap-2" aria-label="Количество мер по направлениям">
          {Object.entries(directions).map(([direction, name]) => {
            const count = decisions.filter((decision) => measures.find((measure) => measure.id === decision.measureId)?.direction === direction).length;
            return (
              <li
                key={direction}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${count > rules.maxPerDirection ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}
              >
                {name}: {count}/{rules.maxPerDirection}
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={!validation.ok || isCalculating}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {isCalculating ? "Рассчитываем…" : "Рассчитать"}
          </button>
          <button
            type="button"
            onClick={loadExample}
            disabled={isCalculating}
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Загрузить пример из ТЗ
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={isCalculating}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Сбросить
          </button>
        </div>
      </section>

      <div aria-live="polite" aria-atomic="true">
        {validation.ok ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            План готов к расчёту: все условия соблюдены.
          </p>
        ) : (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p className="font-semibold">Условия для расчёта</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {validation.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-7">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Каталог мер</h2>
          <p className="mt-1 text-sm text-slate-500">Выберите {rules.decisionsExactly} мер и укажите районы для локальных изменений.</p>
        </div>

        {Object.entries(directions).map(([direction, name]) => (
          <fieldset key={direction} disabled={isCalculating} className="min-w-0">
            <legend className="mb-3 text-base font-semibold text-slate-800">{name}</legend>
            <div className="grid gap-3 xl:grid-cols-2">
              {measures.filter((measure) => measure.direction === direction).map((measure) => {
                const decision = decisions.find((item) => item.measureId === measure.id);
                const selected = decision !== undefined;
                return (
                  <div key={measure.id} className={`rounded-xl border p-4 transition ${selected ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id={`measure-${measure.id}`}
                        checked={selected}
                        onChange={(event) => toggleMeasure(measure.id, event.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
                      />
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`measure-${measure.id}`} className="block cursor-pointer text-sm font-semibold leading-6 text-slate-900">
                          <span className="mr-2 text-indigo-600">{measure.id}</span>{" "}{measure.name}
                        </label>
                        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                          <span>Стоимость: <strong className="font-semibold text-slate-800">{measure.cost}</strong></span>
                          <span>Лаг: {measure.lag} кв.</span>
                          <span>Тип: {measure.scope === "district" ? "район" : "город"}</span>
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="mr-1 text-slate-500">Эффекты:</span>
                          {indicators.filter((indicator) => measure.effects[indicator.code] !== undefined).map((indicator) => {
                            const effect = measure.effects[indicator.code]!;
                            return (
                              <span
                                key={indicator.code}
                                title={indicator.name}
                                className={`rounded-md px-2 py-1 font-medium ${effect < 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}
                              >
                                {indicator.code} {effect > 0 ? "+" : ""}{effect}
                              </span>
                            );
                          })}
                        </div>
                        {selected && measure.scope === "district" && (
                          <div className="mt-4">
                            <label htmlFor={`district-${measure.id}`} className="mb-1.5 block text-xs font-medium text-slate-700">Район для {measure.id}</label>
                            <select
                              id={`district-${measure.id}`}
                              value={decision.districtId ?? ""}
                              onChange={(event) => selectDistrict(measure.id, event.target.value)}
                              aria-invalid={!decision.districtId}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="">Выберите район</option>
                              {districts.map((district) => <option key={district.id} value={district.id}>{district.name}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </form>
  );
}
