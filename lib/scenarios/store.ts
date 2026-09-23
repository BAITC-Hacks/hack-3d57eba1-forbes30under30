import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { measures, type Decision } from "../engine/data";
import { score } from "../engine/score";
import { validate } from "../engine/validate";
import { getEvent } from "../engine/events";
import { savedScenarioSchema, type SavedScenario } from "./schema";

const scenariosSchema = z.array(savedScenarioSchema);
let writes: Promise<void> = Promise.resolve();

function scenariosPath(): string {
  return path.join(process.cwd(), "data", "scenarios.json");
}

async function readScenarios(filePath: string): Promise<SavedScenario[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const scenarios = scenariosSchema.parse(JSON.parse(content));
  if (scenarios.some((scenario) => !validate(scenario.decisions).ok)) {
    throw new Error("Файл сценариев содержит недопустимый набор решений.");
  }
  scenarios.forEach((scenario) => getEvent(scenario.eventId));
  return scenarios;
}

function compareScenarios(a: SavedScenario, b: SavedScenario): number {
  return b.score - a.score
    || a.createdAt.localeCompare(b.createdAt)
    || a.name.localeCompare(b.name, "ru")
    || JSON.stringify(a.decisions).localeCompare(JSON.stringify(b.decisions));
}

export async function listScenarios(): Promise<SavedScenario[]> {
  const filePath = scenariosPath();
  await writes;
  return (await readScenarios(filePath)).sort(compareScenarios);
}

export function saveScenario(input: {
  name: string;
  decisions: Decision[];
  eventId?: string;
}): Promise<SavedScenario> {
  const filePath = scenariosPath();
  const save = writes.then(async () => {
    if (!validate(input.decisions).ok) {
      throw new Error("Нельзя сохранить недопустимый набор решений.");
    }
    const scenarios = await readScenarios(filePath);
    getEvent(input.eventId);
    const calc = score(input.decisions, { eventId: input.eventId });
    const scenario = savedScenarioSchema.parse({
      name: input.name,
      decisions: input.decisions,
      score: calc.score,
      cost: measures.reduce((total, measure) => (
        total + (input.decisions.some((decision) => decision.measureId === measure.id)
          ? measure.cost : 0)
      ), 0),
      createdAt: new Date().toISOString(),
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    });
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify([...scenarios, scenario], null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      await rename(temporaryPath, filePath);
    } finally {
      // rename normally removes this file; cleanup also covers a failed write.
      await unlink(temporaryPath).catch(() => undefined);
    }
    return scenario;
  });
  // A failed write must not block the next request or discard existing records.
  writes = save.then(() => undefined, () => undefined);
  return save;
}
