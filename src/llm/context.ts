/**
 * Context window management.
 *
 * Maintains a sliding window of messages that fits within the token budget.
 * Uses a rough character-based estimate (1 token ≈ 4 chars) for simplicity.
 * A proper tokenizer (tiktoken) can be added later for accuracy.
 */

import type { ChatMessage } from "./client.js";

const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a message.
 */
export function estimateTokens(message: ChatMessage): number {
  let chars = 0;
  if (message.content) {
    chars += message.content.length;
  }
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      chars += tc.function.name.length + (tc.function.arguments?.length ?? 0);
    }
  }
  // Add overhead for role, metadata
  chars += 20;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Estimate total tokens for a list of messages.
 */
export function estimateTotalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

/**
 * Trim messages to fit within the token budget.
 * Always keeps the system message (first) and the most recent messages.
 * Removes the oldest non-system messages first.
 */
export function trimMessages(
  messages: ChatMessage[],
  maxTokens: number,
): ChatMessage[] {
  const totalTokens = estimateTotalTokens(messages);
  if (totalTokens <= maxTokens) {
    return messages;
  }

  // Separate system message from the rest
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  const systemTokens = estimateTotalTokens(systemMessages);
  const budgetForOther = maxTokens - systemTokens;

  if (budgetForOther <= 0) {
    // System message alone exceeds budget — just return it truncated
    return systemMessages;
  }

  // Keep messages from the end until we exceed the budget
  const kept: ChatMessage[] = [];
  let keptTokens = 0;

  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(otherMessages[i]!);
    if (keptTokens + msgTokens > budgetForOther) {
      break;
    }
    kept.unshift(otherMessages[i]!);
    keptTokens += msgTokens;
  }

  // Drop orphaned messages at the start of the kept window.
  // Anthropic requires every tool_result to have a matching tool_use
  // in the immediately preceding assistant message. If trimming cut
  // away that assistant message, the tool results cause a 400 error.
  // Also drop assistant+tool_call messages whose tool results may be
  // incomplete. We want the window to start with a clean user message.
  let cleaned = false;
  while (!cleaned && kept.length > 0) {
    const first = kept[0]!;
    if (first.role === "tool") {
      // Orphaned tool result — its assistant/tool_use was trimmed
      kept.shift();
    } else if (
      first.role === "assistant" &&
      first.tool_calls &&
      first.tool_calls.length > 0
    ) {
      // Assistant with tool_calls at boundary — tool results may be
      // incomplete, and this creates a broken tool_use/tool_result pair
      const toolCallIds = new Set(first.tool_calls.map((tc) => tc.id));
      kept.shift();
      // Also drop any following tool results for these calls
      while (
        kept.length > 0 &&
        kept[0]!.role === "tool" &&
        kept[0]!.tool_call_id &&
        toolCallIds.has(kept[0]!.tool_call_id)
      ) {
        kept.shift();
      }
    } else {
      cleaned = true;
    }
  }

  return [...systemMessages, ...kept];
}
