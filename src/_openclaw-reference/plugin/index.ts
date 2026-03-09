/**
 * OpenClaw plugin: Vending Bench Tools
 *
 * Registers all 14 vending machine simulation tools with openclaw.
 * Tools read/write VendingWorld state from a shared state file
 * (path provided via VENDING_STATE_FILE env var).
 *
 * This plugin is loaded by openclaw when running in vending bench mode.
 */

import { createVendingTools } from "./tools.js";

/**
 * Plugin definition object.
 * openclaw calls the `register` function with a PluginApi.
 */
export default {
  id: "vending-bench",
  name: "Vending Bench Tools",
  description: "14 vending machine simulation tools for the Vending Bench eval",
  version: "0.1.0",

  register(api: any): void {
    const tools = createVendingTools();

    for (const tool of tools) {
      api.registerTool(tool, { name: tool.name });
    }

    api.logger.info(`vending-bench: registered ${tools.length} tools`);
  },
};
