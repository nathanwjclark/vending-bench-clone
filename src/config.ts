/**
 * Configuration for the vending bench simulation.
 */

export interface SimulationConfig {
  /** Execution mode */
  mode: "direct" | "openclaw" | "agent";

  /** LLM model for the agent */
  model: string;

  /** LLM model for supplier email responses (defaults to model if not set) */
  supplierModel?: string;

  /** Number of simulated days */
  totalDays: number;

  /** Maximum token budget for context window */
  maxContextTokens: number;

  /** Maximum messages before forcing context trim */
  maxMessages: number;

  /** Checkpoint interval (save every N days, 0 = disabled) */
  checkpointInterval: number;

  /** Log directory */
  logDir: string;

  /** Whether to use LLM for supplier email responses (vs static) */
  useLlmSuppliers: boolean;

  /** Event system temperature (0 = no events, 1 = full rate) */
  eventTemperature: number;

  /** Seed for deterministic event randomness */
  eventSeed: number;

  /** Anthropic API key (from env if not set) */
  apiKey?: string;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  mode: "direct",
  model: "claude-sonnet-4-6",
  totalDays: 365,
  maxContextTokens: 69_000,
  maxMessages: 200,
  checkpointInterval: 30,
  logDir: "logs",
  useLlmSuppliers: true,
  eventTemperature: 0.5,
  eventSeed: 42,
};

export function resolveConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    apiKey:
      overrides.apiKey ??
      process.env["ANTHROPIC_API_KEY"] ??
      process.env["CLAUDE_API_KEY"] ??
      undefined,
  };
}
