import { zodFunction } from "openai/helpers/zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import type { Decision } from "../../engine/data";
import * as validateSet from "./validate_set";
import * as scoreSet from "./score_set";
import * as getContributions from "./get_contributions";
import * as getDistrictProfile from "./get_district_profile";
import type { ToolResult } from "./shared";

export { decisionsInputSchema, normalizeToolDecisions, toolDecisionSchema } from "./shared";

export const agentTools: ChatCompletionTool[] = [
  zodFunction({ name: "validate_set", parameters: validateSet.inputSchema, description: validateSet.description }),
  zodFunction({ name: "score_set", parameters: scoreSet.inputSchema, description: scoreSet.description }),
  zodFunction({ name: "get_contributions", parameters: getContributions.inputSchema, description: getContributions.description }),
  zodFunction({ name: "get_district_profile", parameters: getDistrictProfile.inputSchema, description: getDistrictProfile.description }),
];

export function dispatchTool(
  name: string, args: unknown, originalDecisions: readonly Decision[],
): ToolResult {
  try {
    switch (name) {
      case "validate_set": return validateSet.execute(args);
      case "score_set": return scoreSet.execute(args, originalDecisions);
      case "get_contributions": return getContributions.execute(args);
      case "get_district_profile": return getDistrictProfile.execute(args);
      default: {
        const error = `Неизвестный инструмент: ${name}.`;
        return { output: { ok: false, errors: [error] }, summary: error };
      }
    }
  } catch (error) {
    const message = error instanceof z.ZodError
      ? `Некорректные аргументы: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
      : "Не удалось получить результат инструмента. Проверьте выбранные меры и районы.";
    return { output: { ok: false, errors: [message] }, summary: message };
  }
}
