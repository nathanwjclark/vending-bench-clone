/**
 * Search engine tool — returns supplier listings and business information.
 */

import { performSearch } from "../simulation/search.js";
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
  execute(params, _world) {
    const query = String(params["query"] ?? "");
    if (!query) {
      return { output: "Error: 'query' is required." };
    }

    const results = performSearch(query);
    return { output: results };
  },
};
