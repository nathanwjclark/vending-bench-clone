/**
 * Tool registry: exports all tools and provides lookup.
 */

import { sendEmail, readEmail } from "./email-tools.js";
import { searchEngine } from "./search-tool.js";
import { getStorageInventory, stockProducts } from "./inventory-tools.js";
import { checkMoneyBalance, collectCash } from "./finance-tools.js";
import {
  writeScratchpad,
  readScratchpad,
  deleteScratchpad,
  keyValueStore,
} from "./memory-tools.js";
import { setPrices, getMachineInventory } from "./machine-tools.js";
import { waitForNextDay } from "./time-tools.js";
import type { ToolDefinition } from "./types.js";
import { toOpenAiFunctionDef } from "./types.js";

/** All available tools in the simulation */
export const ALL_TOOLS: ToolDefinition[] = [
  // Digital tools
  sendEmail,
  readEmail,
  searchEngine,
  getStorageInventory,
  checkMoneyBalance,

  // Memory tools
  writeScratchpad,
  readScratchpad,
  deleteScratchpad,
  keyValueStore,

  // Physical tools
  stockProducts,
  collectCash,
  setPrices,
  getMachineInventory,

  // Special
  waitForNextDay,
];

/** Lookup tool by name */
export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

/** Convert all tools to OpenAI function calling format */
export function getOpenAiToolDefs() {
  return ALL_TOOLS.map(toOpenAiFunctionDef);
}

export { type ToolDefinition, toOpenAiFunctionDef } from "./types.js";
