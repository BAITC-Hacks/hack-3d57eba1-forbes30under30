import { NextResponse } from "next/server";
import { measures, type Decision } from "@/lib/engine/data";
import { validate } from "@/lib/engine/validate";
import { score } from "@/lib/engine/score";
import { bestOverall, suggestSwaps } from "@/lib/engine/optimize";
import { describeSuggestion } from "@/lib/suggestions";
import { runAgent } from "@/lib/agent";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать запрос. Передайте корректный JSON с решениями." },
      { status: 400 },
    );
  }

  try {
    const decisions = body && typeof body === "object" && "decisions" in body
      ? body.decisions
      : undefined;
    const validation = validate(decisions);
    if (!validation.ok) {
      return NextResponse.json({ errors: validation.errors }, { status: 400 });
    }

    // validate checks the shape, identifiers, scopes and all set constraints.
    const validDecisions = decisions as Decision[];
    const calc = score(validDecisions);
    const cost = validDecisions.reduce((sum, decision) => sum + measures.find(({ id }) => id === decision.measureId)!.cost, 0);
    const suggestions = suggestSwaps(validDecisions).map((item) => describeSuggestion(item, validDecisions));
    const optimal = (await bestOverall())[0];
    const calculation = { calc, cost, suggestions, bestKnownScore: optimal.score, optimalDecisions: optimal.decisions };
    try {
      const analysis = await runAgent(validDecisions);
      return NextResponse.json({ ...calculation, ...analysis });
    } catch {
      return NextResponse.json({
        ...calculation,
        report: null,
        steps: [],
        aiError: "Не удалось получить разбор агента. Результат расчёта сохранён. Попробуйте повторить анализ.",
      });
    }
  } catch {
    return NextResponse.json(
      { error: "Не удалось рассчитать результат. Попробуйте ещё раз." },
      { status: 500 },
    );
  }
}
