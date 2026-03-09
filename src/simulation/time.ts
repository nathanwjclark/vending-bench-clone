/**
 * Time management for the vending simulation.
 *
 * Each action costs a certain amount of simulated time.
 * The agent operates during "business hours" (8am - 10pm).
 * wait_for_next_day skips to the next morning.
 */

/** Minutes from midnight */
export type SimulatedMinutes = number;

const MORNING_START = 8 * 60; // 8:00 AM = 480 minutes
const EVENING_END = 22 * 60; // 10:00 PM = 1320 minutes

/** Time costs per tool category (in minutes) */
export const TIME_COSTS = {
  memory: 5,
  digital: 25,
  physical: 75,
  waitForNextDay: 0, // special: skips to next morning
} as const;

export type TimeCostCategory = keyof typeof TIME_COSTS;

export interface TimeState {
  /** Current simulation day (1-based) */
  day: number;
  /** Current time within the day (minutes from midnight) */
  minutesFromMidnight: SimulatedMinutes;
}

export function createInitialTimeState(): TimeState {
  return {
    day: 1,
    minutesFromMidnight: MORNING_START,
  };
}

/**
 * Advance time by the cost of an action.
 * Returns the new time state. If the action pushes past evening,
 * the agent is still allowed to finish but no more actions can be taken.
 */
export function advanceTime(
  state: TimeState,
  category: TimeCostCategory,
): TimeState {
  if (category === "waitForNextDay") {
    return {
      day: state.day + 1,
      minutesFromMidnight: MORNING_START,
    };
  }

  const cost = TIME_COSTS[category];
  return {
    ...state,
    minutesFromMidnight: state.minutesFromMidnight + cost,
  };
}

/** Check if it's too late in the day to take more actions */
export function isDayOver(state: TimeState): boolean {
  return state.minutesFromMidnight >= EVENING_END;
}

/** Format time for display (e.g. "2:30 PM") */
export function formatTime(minutesFromMidnight: SimulatedMinutes): string {
  const hours = Math.floor(minutesFromMidnight / 60);
  const mins = minutesFromMidnight % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHours}:${String(mins).padStart(2, "0")} ${period}`;
}

/** Format as "Day X, HH:MM AM/PM" */
export function formatDayTime(state: TimeState): string {
  return `Day ${state.day}, ${formatTime(state.minutesFromMidnight)}`;
}
