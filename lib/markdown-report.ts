import { districts, measures, rules, type Decision } from "./engine/data";
import type { CityEvent } from "./engine/events";
import type { ScoreResult } from "./engine/score";
import type { AgentReport } from "./agent/schemas";
import { formatDelta, formatNumber, formatScore, formatScoreDelta } from "./format";

export type MarkdownReportInput = {
  name: string;
  decisions: readonly Decision[];
  calc: ScoreResult;
  cost: number;
  report: AgentReport | null;
  activeEvent?: CityEvent | null;
};
const escape = (text: string) => text.replace(/[\r\n]+/g, " ").replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]#|]/g, "\\$&");

export function buildMarkdownReport({ name, decisions, calc, cost, report, activeEvent }: MarkdownReportInput): string {
  const lines = [
    `# ${escape(name.trim() || "Сценарий Астаны")}`,
    "", "Аким на 5 часов — краткий отчёт", "",
    `**Score:** ${formatScore(calc.score)} · **База:** ${formatScore(calc.baseScore)} · **Дельта:** ${formatScoreDelta(calc.delta)}`,
    `**Стоимость:** ${formatNumber(cost)} из ${formatNumber(rules.budget)}`, "",
    "## Активное событие", "",
  ];
  if (activeEvent) {
    lines.push(`**${escape(activeEvent.title)}**`, "", escape(activeEvent.description), "");
    for (const [districtId, effects] of Object.entries(activeEvent.effects)) {
      lines.push(`- ${escape(districts.find(({ id }) => id === districtId)?.name ?? districtId)}: ${Object.entries(effects).map(([code, value]) => `${code} ${formatDelta(value)}`).join(", ")}`);
    }
    lines.push("", "База и значения «до мер» уже учитывают событие. Дельта показывает эффект выбранных мер после события.");
  } else lines.push("Событие не активно.");
  lines.push("", "## Выбранные меры", "", "| Мера | Район | Стоимость |", "| --- | --- | ---: |");
  for (const decision of decisions) {
    const measure = measures.find(({ id }) => id === decision.measureId);
    if (!measure) throw new Error("Не найдена мера для отчёта.");
    const district = districts.find(({ id }) => id === decision.districtId)?.name ?? "Весь город";
    lines.push(`| ${measure.id} ${escape(measure.name)} | ${escape(district)} | ${formatNumber(measure.cost)} |`);
  }
  lines.push("", "## Индексы районов", "", "| Район | D до мер | D после мер |", "| --- | ---: | ---: |");
  for (const district of calc.districts) {
    lines.push(`| ${escape(district.name)} | ${formatScore(district.D_before)} | ${formatScore(district.D_after)} |`);
  }
  lines.push("", "## Критические значения после мер", "");
  if (calc.criticals.length === 0) lines.push(`Показателей ниже ${formatNumber(rules.criticalThreshold)} нет.`);
  else for (const critical of calc.criticals) {
    lines.push(`- ${escape(districts.find(({ id }) => id === critical.districtId)?.name ?? critical.districtId)} · ${critical.indicator}: ${formatNumber(critical.value)}`);
  }
  lines.push("", "## Краткий разбор", "", report ? escape(report.summary) : "AI-разбор недоступен. Числовые результаты рассчитаны движком.");
  lines.push("", "## Рекомендации", "");
  if (!report) lines.push("Рекомендации агента пока не получены.");
  else if (report.recommendations.length === 0) lines.push("Подтверждённых рекомендаций по замене одной меры нет.");
  else for (const recommendation of report.recommendations) {
    lines.push(`- ${escape(recommendation.change)} Ожидаемая дельта Score: **${formatScoreDelta(recommendation.expectedDelta)}**. ${escape(recommendation.why)}`);
  }
  return `${lines.join("\n")}\n`;
}
