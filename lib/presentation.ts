import PptxGenJS from "pptxgenjs";
import { directions, districts, measures, rules } from "./engine/data";
import { formatNumber, formatScore, formatScoreDelta } from "./format";
import type { MarkdownReportInput } from "./markdown-report";
import type { Suggestion } from "./result-schema";

export type PresentationInput = MarkdownReportInput & {
  suggestions: readonly Suggestion[];
  bestKnownScore: number;
};

const INK = "0F172A";
const MUTED = "475569";
const ACCENT = "4338CA";
const GREEN = "047857";
const RED = "BE123C";
const WIDTH = 12;

function excerpt(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const end = clean.lastIndexOf(" ", limit - 1);
  return `${clean.slice(0, end >= limit * 0.65 ? end : limit - 1).trimEnd()}…`;
}

function text(slide: PptxGenJS.Slide, content: string, options: PptxGenJS.TextPropsOptions) {
  slide.addText(content, {
    fontFace: "Arial", fontSize: 20, color: INK, lang: "ru-RU",
    margin: 0, breakLine: false, valign: "top", fit: "shrink", ...options,
  });
}

function table(slide: PptxGenJS.Slide, headers: string[], rows: string[][], widths: number[], rowHeight = 0.72) {
  const cells: PptxGenJS.TableRow[] = [
    headers.map((value) => ({ text: value, options: { bold: true, color: ACCENT, fill: { color: "EEF2FF" } } })),
    ...rows.map((row) => row.map((value, index) => ({
      text: value,
      options: { align: index === 0 ? "left" as const : "center" as const },
    }))),
  ];
  slide.addTable(cells, {
    x: 0.65, y: 1.5, w: WIDTH, h: 0.58 + rows.length * rowHeight,
    colW: widths, rowH: [0.58, ...rows.map(() => rowHeight)],
    fontFace: "Arial", fontSize: 18, color: INK, lang: "ru-RU", margin: 0.12,
    valign: "middle", border: { color: "CBD5E1", pt: 0.7 },
    fill: { color: "FFFFFF" }, autoPage: false,
  });
}

/** Builds an editable eight-slide deck from an already calculated scenario. */
export function buildPresentation(data: PresentationInput): PptxGenJS {
  const { name, decisions, calc, cost, report, activeEvent, suggestions, bestKnownScore } = data;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Аким на 5 часов";
  pptx.subject = "Результат сценария управления городом";
  pptx.title = name.trim() || "Сценарий Астаны";
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };

  function slide(title: string, page: number) {
    const result = pptx.addSlide();
    result.background = { color: "FFFFFF" };
    text(result, title, { x: 0.65, y: 0.48, w: WIDTH, h: 0.65, fontSize: 34, bold: true });
    text(result, `${formatNumber(page)} / ${formatNumber(8)}`, {
      x: 11.65, y: 7.03, w: 1, h: 0.25, fontSize: 12, color: MUTED, align: "right",
    });
    return result;
  }

  const cover = slide("Аким на 5 часов", 1);
  text(cover, "AI-симулятор управления городом", { x: 0.65, y: 1.32, w: WIDTH, h: 0.65, fontSize: 26, color: ACCENT });
  text(cover, excerpt(pptx.title, 100), { x: 0.65, y: 2.5, w: WIDTH, h: 1.95, fontSize: 44, bold: true });
  text(cover, `Бюджет ${formatNumber(rules.budget)}. Решений: ${formatNumber(decisions.length)}.`, {
    x: 0.65, y: 5.0, w: WIDTH, h: 0.5, fontSize: 24, color: MUTED,
  });
  text(cover, new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Almaty" }).format(new Date()), {
    x: 0.65, y: 6.08, w: WIDTH, h: 0.45, fontSize: 20, color: MUTED,
  });

  const problem = slide("Задача городского управленца", 2);
  const problemItems = [
    `Ограниченный бюджет нужно распределить между ${formatNumber(Object.keys(directions).length)} направлениями с учётом лагов и взаимных эффектов мер.`,
    `Среднего результата недостаточно: самый слабый район имеет вес ${formatNumber(30)}% в формуле Score.`,
    "Движок рассчитывает показатели и допустимые замены. AI получает числа через инструменты и объясняет компромиссы.",
  ];
  problemItems.forEach((item, index) => text(problem, item, {
    x: 0.75, y: 1.65 + index * 1.52, w: 11.7, h: 1.13, fontSize: 25,
    bullet: { indent: 25 }, paraSpaceAfter: 12,
  }));

  const choices = slide("Выбранные меры", 3);
  const measureRows = decisions.map((decision) => {
    const measure = measures.find(({ id }) => id === decision.measureId);
    if (!measure) throw new Error("Не найдена мера для презентации.");
    const district = decision.districtId
      ? districts.find(({ id }) => id === decision.districtId)?.name
      : "Весь город";
    if (!district) throw new Error("Не найден район для презентации.");
    return [`${measure.id} ${measure.name}`, district, formatNumber(measure.cost)];
  });
  table(choices, ["Мера", "Район", "Стоимость"], measureRows, [7.7, 2.4, 1.9], 0.82);
  text(choices, `Стоимость набора: ${formatNumber(cost)} из ${formatNumber(rules.budget)}`, {
    x: 0.65, y: 6.53, w: WIDTH, h: 0.4, fontSize: 24, bold: true, color: ACCENT,
  });

  const outcome = slide("Результат сценария", 4);
  const weakest = calc.districts.reduce<(typeof calc.districts)[number] | undefined>((current, district) => (
    !current || district.D_after < current.D_after ? district : current
  ), undefined);
  text(outcome, "Astana Quality of Life Score", { x: 0.65, y: 1.52, w: 5.65, h: 0.4, fontSize: 19, color: MUTED });
  text(outcome, formatScore(calc.score), { x: 0.65, y: 2.06, w: 5.6, h: 1.22, fontSize: 76, bold: true, color: ACCENT });
  text(outcome, `База: ${formatScore(calc.baseScore)}`, { x: 0.65, y: 3.65, w: 5.6, h: 0.5, fontSize: 23 });
  text(outcome, `Дельта Score: ${formatScoreDelta(calc.delta)}`, {
    x: 0.65, y: 4.32, w: 5.6, h: 0.5, fontSize: 23, color: calc.delta < 0 ? RED : GREEN,
  });
  text(outcome, `D_avg: ${formatScore(calc.dAvg)}`, { x: 6.55, y: 1.6, w: 6.1, h: 0.5, fontSize: 24 });
  text(outcome, `Самый слабый район: ${weakest?.name ?? "не определён"}\nD: ${formatScore(calc.minDistrict)}`, {
    x: 6.55, y: 2.36, w: 6.1, h: 0.9, fontSize: 22,
  });
  text(outcome, `Критических значений: ${formatNumber(calc.criticals.length)}`, {
    x: 6.55, y: 3.63, w: 6.1, h: 0.48, fontSize: 22, color: calc.criticals.length ? RED : GREEN,
  });
  const criticals = calc.criticals.slice(0, 3).map((critical) => (
    `${districts.find(({ id }) => id === critical.districtId)?.name ?? critical.districtId}: ${critical.indicator} = ${formatNumber(critical.value)}`
  ));
  text(outcome, criticals.length
    ? `${criticals.join("\n")}${calc.criticals.length > 3 ? "\nПолный перечень в Markdown-отчёте." : ""}`
    : `Показателей ниже ${formatNumber(rules.criticalThreshold)} нет.`, {
    x: 6.55, y: 4.26, w: 6.1, h: 1.23, fontSize: 18, color: MUTED,
  });
  text(outcome, activeEvent ? `Событие: ${excerpt(activeEvent.title, 150)}` : "Неожиданное событие не активно.", {
    x: 0.65, y: 5.86, w: WIDTH, h: 0.62, fontSize: 20, color: activeEvent ? RED : MUTED,
  });
  if (activeEvent) text(outcome, "База уже учитывает событие. Дельта показывает эффект выбранных мер после события.", {
    x: 0.65, y: 6.57, w: WIDTH, h: 0.32, fontSize: 15, color: MUTED,
  });

  const districtSlide = slide("Изменения по районам", 5);
  table(districtSlide, ["Район", "D до мер", "D после мер"], calc.districts.map((district) => [
    district.name, formatScore(district.D_before), formatScore(district.D_after),
  ]), [6, 3, 3], 0.75);
  text(districtSlide, activeEvent
    ? "Индексы до мер рассчитаны с активным событием. Все значения получены из движка."
    : "Индекс D объединяет показатели района с весами из модели. Все значения получены из движка.", {
    x: 0.65, y: 6.16, w: WIDTH, h: 0.7, fontSize: 19, color: MUTED,
  });

  const explanation = slide("Разбор сценария", 6);
  if (report) {
    text(explanation, excerpt(report.summary, 260), { x: 0.65, y: 1.48, w: WIDTH, h: 1.4, fontSize: 21 });
    for (const [index, section] of [
      { title: "Сильные стороны", items: report.strengths, color: GREEN },
      { title: "Риски", items: report.risks, color: RED },
    ].entries()) {
      const x = 0.65 + index * 6.2;
      text(explanation, section.title, { x, y: 3.15, w: 5.75, h: 0.45, fontSize: 24, bold: true, color: section.color });
      const items = section.items.length ? section.items.slice(0, 2) : ["Агент не отметил."];
      items.forEach((item, row) => text(explanation, excerpt(item, 120), {
        x, y: 3.82 + row * 1.25, w: 5.75, h: 1.0, fontSize: 18,
      }));
    }
    text(explanation, "Краткая выжимка. Полный разбор на экране, summary и рекомендации в Markdown-отчёте.", {
      x: 0.65, y: 6.55, w: WIDTH, h: 0.4, fontSize: 14, color: MUTED,
    });
  } else {
    text(explanation, "AI-разбор не выполнялся, числа рассчитаны движком", {
      x: 0.75, y: 2.45, w: 11.6, h: 1.5, fontSize: 32, color: MUTED,
    });
    text(explanation, "Подтверждённые расчётом замены доступны на следующем слайде независимо от AI.", {
      x: 0.75, y: 4.6, w: 11.6, h: 0.9, fontSize: 22,
    });
  }

  const recommendations = slide("Рекомендации по расчёту", 7);
  if (suggestions.length > 0) {
    text(recommendations, "Каждая замена рассчитана отдельно относительно текущего набора.", {
      x: 0.65, y: 1.16, w: WIDTH, h: 0.38, fontSize: 17, color: MUTED,
    });
    suggestions.slice(0, 3).forEach((suggestion, index) => {
      const y = 1.75 + index * 1.64;
      text(recommendations, excerpt(suggestion.change, 240), {
        x: 0.65, y, w: WIDTH, h: 0.94, fontSize: 20, bold: true,
      });
      text(recommendations, `Новый Score: ${formatScore(suggestion.newScore)}    Дельта: ${formatScoreDelta(suggestion.delta)}    Стоимость: ${formatNumber(suggestion.cost)}`, {
        x: 0.65, y: y + 1.02, w: WIDTH, h: 0.45, fontSize: 20, color: GREEN,
      });
    });
  } else {
    const comparable = Number.isFinite(calc.score) && Number.isFinite(bestKnownScore);
    const isOptimal = comparable && Math.abs(calc.score - bestKnownScore) <= 1e-9;
    text(recommendations, isOptimal
      ? `Набор достиг лучшего результата текущей модели: ${formatScore(bestKnownScore)}.`
      : "Улучшений заменой одной меры не найдено.", {
      x: 0.75, y: 2.05, w: 11.6, h: 1.25, fontSize: 30, color: isOptimal ? GREEN : INK,
    });
    if (comparable && calc.score < bestKnownScore - 1e-9) text(recommendations,
      `Это локальный максимум для одиночных замен. Лучший возможный Score: ${formatScore(bestKnownScore)}. Оптимальный набор доступен в приложении.`, {
        x: 0.75, y: 4.05, w: 11.6, h: 1.4, fontSize: 24, color: MUTED,
      });
  }

  const next = slide("Следующие шаги", 8);
  text(next, "Возможное развитие проекта", { x: 0.65, y: 1.2, w: WIDTH, h: 0.4, fontSize: 20, color: MUTED });
  const nextSteps = [
    ["Реальные данные и другие города", "Подготовить районные показатели, стоимости и обоснованные эффекты программ. Адаптировать схемы и проверки."],
    ["Многолетний горизонт", "Добавить бюджеты по годам, результаты по периодам и проверку переноса эффектов между годами."],
    ["Граждане и публичные слушания", "Собирать предложения и приоритеты, согласовывать исходные допущения и сравнивать планы ведомств."],
  ];
  nextSteps.forEach(([title, description], index) => {
    const y = 1.94 + index * 1.6;
    text(next, title, { x: 0.65, y, w: WIDTH, h: 0.45, fontSize: 25, bold: true, color: ACCENT });
    text(next, description, { x: 0.65, y: y + 0.63, w: WIDTH, h: 0.73, fontSize: 21 });
  });

  return pptx;
}
