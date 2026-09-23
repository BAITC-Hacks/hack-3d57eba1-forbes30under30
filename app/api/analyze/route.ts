import { NextResponse } from "next/server";
import type { Decision } from "@/lib/engine/data";
import { validate } from "@/lib/engine/validate";
import { score } from "@/lib/engine/score";

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
    return NextResponse.json({ calc: score(decisions as Decision[]) });
  } catch {
    return NextResponse.json(
      { error: "Не удалось рассчитать результат. Попробуйте ещё раз." },
      { status: 500 },
    );
  }
}
