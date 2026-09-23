import { NextResponse } from "next/server";
import { measures, type Decision } from "@/lib/engine/data";
import { validate } from "@/lib/engine/validate";
import { score } from "@/lib/engine/score";
import { bestOverall, suggestSwaps } from "@/lib/engine/optimize";
import { describeSuggestion } from "@/lib/suggestions";
import { getEvent } from "@/lib/engine/events";

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
      ? body.decisions : undefined;
    const validation = validate(decisions);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.errors.join(" "), errors: validation.errors }, { status: 400 });
    }
    const eventId = body && typeof body === "object" && "eventId" in body ? body.eventId : undefined;
    if (eventId !== undefined && typeof eventId !== "string") {
      return NextResponse.json({ error: "Передайте корректный идентификатор события." }, { status: 400 });
    }
    let activeEvent;
    try {
      activeEvent = getEvent(eventId);
    } catch {
      return NextResponse.json({ error: "Неизвестное событие. Выберите событие из списка." }, { status: 400 });
    }

    const validDecisions = decisions as Decision[];
    const options = { eventId };
    const calc = score(validDecisions, options);
    const cost = validDecisions.reduce((sum, decision) => sum + measures.find(({ id }) => id === decision.measureId)!.cost, 0);
    const suggestions = suggestSwaps(validDecisions, options).map((item) => describeSuggestion(item, validDecisions));
    const optimal = (await bestOverall(options))[0];
    return NextResponse.json({
      calc, cost, suggestions, bestKnownScore: optimal.score, optimalDecisions: optimal.decisions,
      eventId, activeEvent: activeEvent ?? null,
      scoreBeforeEvent: activeEvent ? score(validDecisions).score : calc.score,
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось рассчитать результат. Попробуйте ещё раз." },
      { status: 500 },
    );
  }
}
