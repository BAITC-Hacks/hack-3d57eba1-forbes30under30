import { z } from "zod";
import eventsJson from "../../data/events.json";
import { districts, indicators, rules, type District, type IndicatorCode } from "./data";

export type CityEvent = {
  id: string;
  title: string;
  description: string;
  effects: Record<string, Partial<Record<IndicatorCode, number>>>;
};
export type ScoreOptions = { eventId?: string };

const eventSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  effects: z.record(z.string(), z.record(z.string(), z.number().finite())),
}).strict();

function loadEvents(): CityEvent[] {
  try {
    const parsed = z.array(eventSchema).parse(eventsJson);
    const districtIds = new Set(districts.map(({ id }) => id));
    const indicatorCodes = new Set<string>(indicators.map(({ code }) => code));
    if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) throw new Error();
    for (const event of parsed) {
      for (const [districtId, effects] of Object.entries(event.effects)) {
        if (!districtIds.has(districtId)) throw new Error();
        if (Object.keys(effects).some((code) => !indicatorCodes.has(code))) throw new Error();
      }
    }
    return parsed;
  } catch {
    throw new Error("Не удалось загрузить события. Проверьте data/events.json.");
  }
}

export const events: CityEvent[] = loadEvents();

export function getEvent(eventId?: string): CityEvent | undefined {
  if (eventId === undefined) return undefined;
  const event = events.find(({ id }) => id === eventId);
  if (!event) throw new Error("Неизвестное событие. Выберите событие из списка.");
  return event;
}

// A fresh copy keeps the dataset immutable; event damage is clipped before any
// measure or synergy is applied, so their effects use the changed baseline.
export function getStartingDistricts(options: ScoreOptions = {}): District[] {
  const event = getEvent(options.eventId);
  return districts.map((district) => {
    const values = { ...district.values };
    const effects = event?.effects[district.id];
    if (effects) {
      for (const { code } of indicators) {
        values[code] = Math.max(rules.clip[0], Math.min(rules.clip[1], values[code] + (effects[code] ?? 0)));
      }
    }
    return { ...district, values };
  });
}
