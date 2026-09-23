import { z } from "zod";
import districtsJson from "../../data/districts.json";
import measuresJson from "../../data/measures.json";

const directionSchema = z.enum([
  "transport", "ecology", "social", "safety", "services",
]);
const indicatorCodeSchema = z.enum([
  "T1", "T2", "E1", "E2", "S1", "S2", "B1", "B2", "C1", "C2",
]);
const valuesSchema = z.object({
  T1: z.number(), T2: z.number(), E1: z.number(), E2: z.number(),
  S1: z.number(), S2: z.number(), B1: z.number(), B2: z.number(),
  C1: z.number(), C2: z.number(),
});
const districtSchema = z.object({
  id: z.string(),
  name: z.string(),
  population: z.number(),
  profile: z.string(),
  values: valuesSchema,
});
const measureSchema = z.object({
  id: z.string(),
  direction: directionSchema,
  name: z.string(),
  scope: z.enum(["district", "city"]),
  cost: z.number(),
  lag: z.number(),
  effects: valuesSchema.partial(),
});
const referenceSetSchema = z.object({
  decisions: z.array(z.tuple([z.string(), z.string().nullable()])),
  cost: z.number(),
  score: z.number(),
  note: z.string().optional(),
});
const districtsFileSchema = z.object({
  scale: z.string(),
  indicators: z.array(z.object({
    code: indicatorCodeSchema,
    direction: directionSchema,
    name: z.string(),
    weight: z.number(),
  })).nonempty(),
  districts: z.array(districtSchema).nonempty(),
});
const measuresFileSchema = z.object({
  directions: z.record(directionSchema, z.string()),
  measures: z.array(measureSchema).nonempty(),
  synergies: z.array(z.object({
    pair: z.tuple([z.string(), z.string()]),
    indicator: indicatorCodeSchema,
    bonus: z.number(),
    appliesTo: z.string(),
    note: z.string(),
  })),
  incompatibilities: z.array(z.object({
    pair: z.tuple([z.string(), z.string()]),
    sameDistrictOnly: z.boolean(),
    reason: z.string(),
  })),
  rules: z.object({
    budget: z.number(),
    decisionsExactly: z.number().int(),
    noRepeats: z.boolean(),
    maxPerDirection: z.number().int(),
    horizonQuarters: z.number().positive(),
    lagFormula: z.string(),
    clip: z.tuple([z.number(), z.number()]),
    criticalThreshold: z.number(),
    score: z.string(),
    D_avg: z.string(),
    D_d: z.string(),
  }),
  referenceValues: z.object({
    baseScore: z.number(),
    baseDavg: z.number(),
    baseMinDistrict: z.number(),
    baseCriticals: z.number(),
    exampleSet: referenceSetSchema,
    cheapestSet: referenceSetSchema,
    bestKnownSet: referenceSetSchema,
  }),
});

export type Decision = { measureId: string; districtId?: string };
export type Direction = z.infer<typeof directionSchema>;
export type IndicatorCode = z.infer<typeof indicatorCodeSchema>;
export type IndicatorValues = z.infer<typeof valuesSchema>;
export type District = z.infer<typeof districtSchema>;
export type Measure = z.infer<typeof measureSchema>;

// Static JSON imports keep the same data available to the browser and Node.js.
function loadData() {
  try {
    return {
      districtsData: districtsFileSchema.parse(districtsJson),
      measuresData: measuresFileSchema.parse(measuresJson),
    };
  } catch {
    throw new Error(
      "Не удалось загрузить данные движка. Проверьте data/districts.json и data/measures.json.",
    );
  }
}

export const { districtsData, measuresData } = loadData();
export const { districts, indicators } = districtsData;
export const {
  measures, directions, rules, synergies, incompatibilities, referenceValues,
} = measuresData;
