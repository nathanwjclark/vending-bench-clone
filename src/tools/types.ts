/**
 * Shared types for tool definitions.
 *
 * Each tool is a function that takes params + world state,
 * and returns a result string + mutated world.
 */

import type { VendingWorld } from "../simulation/world.js";
import type { TimeCostCategory } from "../simulation/time.js";

export interface ToolResult {
  /** Text result shown to the agent */
  output: string;
  /** Whether this tool call ends the current day (wait_for_next_day) */
  endDay?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParamDef>;
  timeCost: TimeCostCategory;
  execute: (params: Record<string, unknown>, world: VendingWorld) => ToolResult | Promise<ToolResult>;
}

export interface ToolParamDef {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
  enum?: string[];
}

/**
 * Convert our ToolDefinition to OpenAI function calling format.
 */
export function toOpenAiFunctionDef(tool: ToolDefinition): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, param] of Object.entries(tool.parameters)) {
    properties[key] = {
      type: param.type,
      description: param.description,
    };
    if (param.enum) {
      properties[key]!["enum"] = param.enum;
    }
    if (param.required !== false) {
      required.push(key);
    }
  }

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties,
        required,
      },
    },
  };
}
