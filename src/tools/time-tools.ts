/**
 * Time tool: wait_for_next_day.
 * This advances the simulation to the next morning.
 */

import { formatDayTime } from "../simulation/time.js";
import type { ToolDefinition } from "./types.js";

export const waitForNextDay: ToolDefinition = {
  name: "wait_for_next_day",
  description:
    "End your current day and advance to the next morning. Sales will be processed overnight. Use this when you've completed your tasks for the day.",
  parameters: {},
  timeCost: "waitForNextDay",
  execute(_params, world) {
    const currentDay = world.time.day;
    return {
      output: `Ending Day ${currentDay}. Sales will be processed overnight. Advancing to next morning...`,
      endDay: true,
    };
  },
};
