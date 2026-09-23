import { NextResponse } from "next/server";
import type { Decision } from "@/lib/engine/data";
import { validate } from "@/lib/engine/validate";
import { scenarioNameSchema } from "@/lib/scenarios/schema";
import { listScenarios, saveScenario } from "@/lib/scenarios/store";
import { getEvent } from "@/lib/engine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listScenarios(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось загрузить сценарии. Проверьте файл data/scenarios.json и повторите попытку." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать запрос. Передайте корректный JSON со сценарием." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Передайте название сценария и набор решений." },
      { status: 400 },
    );
  }
  const input = body as Record<string, unknown>;
  if (input.eventId !== undefined && typeof input.eventId !== "string") {
    return NextResponse.json({ error: "Передайте корректный идентификатор события." }, { status: 400 });
  }
  try {
    getEvent(input.eventId);
  } catch {
    return NextResponse.json({ error: "Неизвестное событие. Сценарий не сохранён." }, { status: 400 });
  }
  const name = scenarioNameSchema.safeParse(input.name);
  if (!name.success) {
    return NextResponse.json(
      { error: "Укажите название сценария: от 1 до 100 символов без учёта пробелов по краям." },
      { status: 400 },
    );
  }
  const validation = validate(input.decisions);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.errors.join(" ") },
      { status: 400 },
    );
  }

  try {
    // Values and time come from the server, never from the submitted score.
    const scenario = await saveScenario({
      name: name.data,
      eventId: input.eventId,
      decisions: (input.decisions as Decision[]).map(({ measureId, districtId }) => ({
        measureId,
        ...(districtId === undefined ? {} : { districtId }),
      })),
    });
    return NextResponse.json(scenario, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Не удалось сохранить сценарий. Проверьте доступ к data/scenarios.json и повторите попытку." },
      { status: 500 },
    );
  }
}
