import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AgentReport from "../components/AgentReport";
import DistrictTable from "../components/DistrictTable";
import ScoreCard from "../components/ScoreCard";
import { referenceValues } from "../lib/engine/data";
import { score } from "../lib/engine/score";
import { formatDelta, formatNumber, formatScore, formatScoreDelta } from "../lib/format";
import type { AgentReport as Report } from "../lib/agent/schemas";
import type { Suggestion } from "../lib/result-schema";

// Next compiles JSX automatically; the tsx script uses the project's preserved
// JSX setting and needs React available while rendering the same components.
Object.assign(globalThis, { React });

const noop = () => undefined;
const baseProps = {
  report: null, steps: [], suggestions: [], isAnalyzing: false, onRetry: noop, onApply: noop,
};
const renderAgent = (props: Partial<React.ComponentProps<typeof AgentReport>>) => (
  renderToStaticMarkup(React.createElement(AgentReport, { ...baseProps, ...props }))
);
const report: Report = {
  summary: "Итог сценария", strengths: ["Сильная сторона"], risks: [], tradeoffs: [], recommendations: [],
};
const optimalMessage = "Это лучший возможный набор из 694 395 допустимых вариантов";
const localMessage = "Заменой одной меры набор не улучшить. Лучший возможный результат — 57,24, нажмите «Показать оптимальный набор»";
const suggestion: Suggestion = {
  replace: "M5", with: "M3", districtId: "nura", newScore: 57.2, delta: 1.2, cost: 100,
  change: "M5 → M3 / Нура",
};

function main(): void {
  let passed = 0;
  function check(name: string, test: () => void): void {
    test();
    passed += 1;
    console.log(`OK: ${name}`);
  }

  check("оптимум определяется по точным значениям и малому epsilon", () => {
    for (const offset of [0, 5e-10, -5e-10]) {
      const html = renderAgent({ score: 57.24 + offset, bestKnownScore: 57.24 });
      assert.equal(html.split(optimalMessage).length - 1, 1);
      assert.ok(html.indexOf("Рекомендации") < html.indexOf(optimalMessage));
    }
    const almostOptimal = renderAgent({ score: 57.239, bestKnownScore: 57.24 });
    assert.ok(!almostOptimal.includes(optimalMessage), "Одинаковое округление не означает оптимум");
    assert.ok(almostOptimal.includes(localMessage));
  });

  check("вывод оптимизатора расположен в рекомендациях после summary, без дублей", () => {
    const html = renderAgent({ report, score: 57.24, bestKnownScore: 57.24 });
    assert.ok(html.indexOf(report.summary) < html.indexOf("Рекомендации"));
    assert.ok(html.indexOf("Рекомендации") < html.indexOf(optimalMessage));
    assert.equal(html.split(optimalMessage).length - 1, 1);
    assert.ok(!html.includes("Дополнительных рекомендаций нет."));
  });

  check("локальный максимум доступен без отчёта и при ошибке агента", () => {
    for (const aiError of [undefined, "Нет ключа OpenAI"]) {
      const html = renderAgent({ report: null, score: 56, bestKnownScore: 57.24, aiError });
      assert.ok(html.includes(localMessage));
      assert.ok(html.indexOf("Рекомендации") < html.indexOf(localMessage));
      if (aiError) {
        assert.ok(html.includes(aiError));
        assert.ok(html.includes("Повторить анализ"));
      }
    }
  });

  check("загрузка скрывает старые выводы, рекомендации и кнопки применения", () => {
    const html = renderAgent({ report, score: 57.24, bestKnownScore: 57.24, isAnalyzing: true });
    assert.ok(html.includes("Агент анализирует сценарий…"));
    assert.ok(html.includes('aria-busy="true"'));
    for (const hidden of [optimalMessage, localMessage, report.summary, "Рекомендации", "Применить"])
      assert.ok(!html.includes(hidden));
  });

  check("рекомендации появляются только из отчёта, применение требует совпадения", () => {
    const noReport = renderAgent({ suggestions: [suggestion], score: 56, bestKnownScore: 57.24 });
    assert.ok(!noReport.includes("Рекомендации"));
    const recommendation = { change: suggestion.change, expectedDelta: 1.2, why: "Подтверждено расчётом" };
    const withRecommendation = { ...report, recommendations: [recommendation] };
    const matched = renderAgent({ report: withRecommendation, suggestions: [suggestion] });
    assert.ok(matched.includes("Применить"));
    assert.ok(matched.includes("Score +1,20"));
    const unmatched = renderAgent({ report: withRecommendation, suggestions: [{ ...suggestion, delta: 1.3 }] });
    assert.ok(!unmatched.includes("Применить"));
    const pending = renderAgent({ report: withRecommendation, suggestions: [suggestion], isAnalyzing: true });
    assert.ok(!pending.includes("Применить"));
  });

  check("отсутствующие и нечисловые значения не создают ложных выводов", () => {
    const html = renderAgent({ score: NaN, bestKnownScore: undefined });
    for (const hidden of ["NaN", "undefined", optimalMessage, "Заменой одной меры"]) assert.ok(!html.includes(hidden));
  });

  const bestDecisions = referenceValues.bestKnownSet.decisions.map(([measureId, districtId]) => ({
    measureId, ...(districtId ? { districtId } : {}),
  }));
  const calc = score(bestDecisions);

  check("ScoreCard показывает компактную стоимость и индексы с двумя знаками", () => {
    const props = { calc, cost: 98, bestKnownScore: calc.score, onShowOptimal: noop, disabled: false };
    const html = renderToStaticMarkup(React.createElement(ScoreCard, props));
    assert.ok(html.includes("Оптимальный набор"));
    assert.match(html, />98 <span[^>]*>из 100<\/span>/);
    assert.ok(html.includes("57,24"));
    assert.ok(html.includes("+4,68"));
    assert.ok(html.includes("52,56"));
    assert.ok(html.includes(formatScore(calc.dAvg)));
    const almost = renderToStaticMarkup(React.createElement(ScoreCard, { ...props, bestKnownScore: calc.score + 0.001 }));
    assert.ok(!almost.includes("Оптимальный набор"));
    const invalid = renderToStaticMarkup(React.createElement(ScoreCard, {
      ...props, cost: NaN, bestKnownScore: NaN,
      calc: { ...calc, score: NaN, baseScore: NaN, delta: NaN, dAvg: NaN, districts: [] },
    }));
    assert.doesNotMatch(invalid, /NaN|undefined|Оптимальный набор/);
  });

  check("таблица сохраняет закреплённые крайние колонки и формат показателей", () => {
    const example = score(referenceValues.exampleSet.decisions.map(([measureId, districtId]) => ({
      measureId, ...(districtId ? { districtId } : {}),
    })));
    const html = renderToStaticMarkup(React.createElement(DistrictTable, { districts: example.districts }));
    assert.ok(html.includes("Индекс района D"));
    assert.ok(html.includes("sticky left-0"));
    assert.ok(html.includes("sticky right-0"));
    assert.ok(html.includes("До: </span>45</span>"));
    assert.ok(html.includes("После: </span>67,5</span>"));
    assert.ok(html.includes("После: </span>57,50</span>"));
  });

  check("обычные числа компактные, индексы с двумя знаками, дельты со знаком", () => {
    assert.equal(formatNumber(40), "40");
    assert.equal(formatNumber(67.5), "67,5");
    assert.equal(formatNumber(48.75), "48,75");
    assert.equal(formatNumber(57.239), "57,24");
    assert.equal(formatDelta(0), "+0");
    assert.equal(formatDelta(12), "+12");
    assert.equal(formatDelta(1.2), "+1,2");
    assert.equal(formatDelta(-1.2), "−1,2");
    assert.equal(formatScore(57.5), "57,50");
    assert.equal(formatScore(40), "40,00");
    assert.equal(formatScoreDelta(0), "+0,00");
    assert.equal(formatScoreDelta(3.98539), "+3,99");
    assert.equal(formatScoreDelta(-1.15), "−1,15");
    for (const format of [formatNumber, formatDelta, formatScore, formatScoreDelta]) {
      for (const value of [NaN, Infinity, -Infinity]) assert.equal(format(value), "—");
    }
  });

  console.log(`Проверки компонентов пройдены: ${passed}.`);
}

try {
  main();
} catch (error: unknown) {
  console.error(`Проверки компонентов не пройдены: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  process.exitCode = 1;
}
