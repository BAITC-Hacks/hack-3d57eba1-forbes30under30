import { z } from "zod";

const reportFields = {
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)),
  risks: z.array(z.string().min(1)),
  tradeoffs: z.array(z.string().min(1)),
};
const recommendationFields = {
  change: z.string().min(1),
  why: z.string().min(1),
};

export const reportSchema = z.object({
  ...reportFields,
  recommendations: z.array(z.object({
    ...recommendationFields,
    expectedDelta: z.number().finite().optional(),
  }).strict()),
}).strict();

// OpenAI strict JSON schemas require every key; null means no calculated delta.
export const reportWireSchema = z.object({
  ...reportFields,
  recommendations: z.array(z.object({
    ...recommendationFields,
    expectedDelta: z.number().finite().nullable(),
  }).strict()),
}).strict();

export const agentStepSchema = z.object({
  name: z.string(),
  detail: z.string(),
}).strict();

export type AgentReport = z.infer<typeof reportSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
