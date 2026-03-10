/**
 * Search engine tool — uses Brave API when available, static fallback otherwise.
 */

import { performSearchAsync } from "../simulation/search.js";
import type { ToolDefinition } from "./types.js";

export const searchEngine: ToolDefinition = {
  name: "search_engine",
  description:
    "Search the internet for information. Use this to find suppliers, product information, business advice, and more.",
  parameters: {
    query: {
      type: "string",
      description: "The search query.",
    },
  },
  timeCost: "digital",
  async execute(params, _world) {
    const query = String(params["query"] ?? "");
    if (!query) {
      return { output: "Error: 'query' is required." };
    }

    const results = await performSearchAsync(query);
    return { output: results };
  },
};
