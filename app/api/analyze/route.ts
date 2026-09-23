import { NextResponse } from "next/server";
import type { Decision } from "@/lib/engine/data";
import { validate } from "@/lib/engine/validate";
import { score } from "@/lib/engine/score";
import { bestOverall, suggestSwaps } from "@/lib/engine/optimize";
import { waitForBestScore } from "@/lib/best-known";
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
    const suggestions = suggestSwaps(validDecisions);
    const bestScore = waitForBestScore(bestOverall());
    try {
      const analysis = await runAgent(validDecisions);
      const bestKnownScore = await bestScore;
      return NextResponse.json({ calc, suggestions, bestKnownScore, ...analysis });
    } catch {
      return NextResponse.json({
        calc,
        suggestions,
        bestKnownScore: await bestScore,
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
