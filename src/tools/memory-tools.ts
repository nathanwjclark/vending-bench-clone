/**
 * Memory tools: scratchpad and key-value store.
 * These are the simplest tools — pure state manipulation.
 */

import type { ToolDefinition } from "./types.js";

export const writeScratchpad: ToolDefinition = {
  name: "write_scratchpad",
  description:
    "Write content to your scratchpad. This overwrites any existing content. Use this to keep notes, plans, and reminders.",
  parameters: {
    content: {
      type: "string",
      description: "The content to write to the scratchpad.",
    },
  },
  timeCost: "memory",
  execute(params, world) {
    const content = String(params["content"] ?? "");
    world.scratchpad = content;
    return { output: `Scratchpad updated (${content.length} characters).` };
  },
};

export const readScratchpad: ToolDefinition = {
  name: "read_scratchpad",
  description: "Read the current contents of your scratchpad.",
  parameters: {},
  timeCost: "memory",
  execute(_params, world) {
    if (!world.scratchpad) {
      return { output: "Scratchpad is empty." };
    }
    return { output: `Scratchpad contents:\n${world.scratchpad}` };
  },
};

export const deleteScratchpad: ToolDefinition = {
  name: "delete_scratchpad",
  description: "Clear all contents of your scratchpad.",
  parameters: {},
  timeCost: "memory",
  execute(_params, world) {
    world.scratchpad = "";
    return { output: "Scratchpad cleared." };
  },
};

export const keyValueStore: ToolDefinition = {
  name: "key_value_store",
  description:
    "A persistent key-value store for saving and retrieving data. Actions: get, set, delete, list.",
  parameters: {
    action: {
      type: "string",
      description: "The action to perform.",
      enum: ["get", "set", "delete", "list"],
    },
    key: {
      type: "string",
      description: "The key to operate on (not needed for 'list').",
      required: false,
    },
    value: {
      type: "string",
      description: "The value to store (only needed for 'set').",
      required: false,
    },
  },
  timeCost: "memory",
  execute(params, world) {
    const action = String(params["action"] ?? "");
    const key = String(params["key"] ?? "");
    const value = String(params["value"] ?? "");

    switch (action) {
      case "get": {
        if (!key) return { output: "Error: 'key' is required for 'get'." };
        const stored = world.kvStore.get(key);
        if (stored === undefined) {
          return { output: `Key "${key}" not found.` };
        }
        return { output: `${key} = ${stored}` };
      }
      case "set": {
        if (!key) return { output: "Error: 'key' is required for 'set'." };
        world.kvStore.set(key, value);
        return { output: `Stored: ${key} = ${value}` };
      }
      case "delete": {
        if (!key) return { output: "Error: 'key' is required for 'delete'." };
        const existed = world.kvStore.delete(key);
        return {
          output: existed
            ? `Deleted key "${key}".`
            : `Key "${key}" not found.`,
        };
      }
      case "list": {
        if (world.kvStore.size === 0) {
          return { output: "Key-value store is empty." };
        }
        const entries = Array.from(world.kvStore.entries())
          .map(([k, v]) => `  ${k} = ${v}`)
          .join("\n");
        return {
          output: `Key-value store (${world.kvStore.size} entries):\n${entries}`,
        };
      }
      default:
        return {
          output: `Error: Unknown action "${action}". Use: get, set, delete, list.`,
        };
    }
  },
};
