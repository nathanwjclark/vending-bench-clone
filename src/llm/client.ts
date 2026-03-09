/**
 * LLM client using Anthropic SDK.
 * Configured to use Claude Sonnet 4.6 by default.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SimulationConfig } from "../config.js";

let _client: Anthropic | null = null;

export function getAnthropicClient(config: SimulationConfig): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: config.apiKey,
    });
  }
  return _client;
}

/** Reset the cached client (useful for tests or config changes). */
export function resetClient(): void {
  _client = null;
}

/**
 * Message types for our conversation history.
 * We use a simplified format and convert to Anthropic's format when calling.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** OpenAI-style function def — we convert to Anthropic format at call time. */
export interface ToolFunctionDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Convert our tool definitions to Anthropic's tool format.
 */
export function toAnthropicTools(
  defs: ToolFunctionDef[],
): Anthropic.Tool[] {
  return defs.map((d) => ({
    name: d.function.name,
    description: d.function.description,
    input_schema: d.function.parameters as Anthropic.Tool.InputSchema,
  }));
}

/**
 * Convert our ChatMessage[] to Anthropic's messages format.
 * Anthropic requires alternating user/assistant roles and separate system param.
 */
export function toAnthropicMessages(
  messages: ChatMessage[],
): { system: string; messages: Anthropic.MessageParam[] } {
  let system = "";
  const out: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system += (system ? "\n\n" : "") + (msg.content ?? "");
      continue;
    }

    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content ?? "" });
    } else if (msg.role === "assistant") {
      // Build content blocks
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch {
            // ignore
          }
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
      if (content.length > 0) {
        out.push({ role: "assistant", content });
      }
    } else if (msg.role === "tool") {
      // Tool results in Anthropic format
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id ?? "",
            content: msg.content ?? "",
          },
        ],
      });
    }
  }

  // Anthropic requires messages to start with user and alternate.
  // Merge consecutive same-role messages.
  const merged: Anthropic.MessageParam[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      // Merge content into last message
      const lastContent = Array.isArray(last.content)
        ? last.content
        : [{ type: "text" as const, text: last.content as string }];
      const newContent = Array.isArray(m.content)
        ? m.content
        : [{ type: "text" as const, text: m.content as string }];
      (last as { content: unknown[] }).content = [
        ...lastContent,
        ...newContent,
      ];
    } else {
      merged.push(m);
    }
  }

  return { system, messages: merged };
}
