/**
 * Agent-mode runner — bridges the simulation with agent-base via HTTP.
 *
 * Instead of invoking openclaw directly, this runner calls agent-base's
 * /eval/configure and /eval/message endpoints. The agent-base process
 * handles the LLM interaction; this runner owns the simulation loop.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SimulationConfig } from "./config.js";
import { processDailySales } from "./simulation/demand.js";
import { processEventsForDay } from "./simulation/event-scheduler.js";
import { calculateScore, formatScoreReport } from "./simulation/scoring.js";
import {
  createVendingWorld,
  processEndOfDay,
  type VendingWorld,
} from "./simulation/world.js";
import { buildSystemPrompt, buildMorningNotification as buildMorningNotif, type DailySnapshot, type RunResult } from "./runner.js";
import { writeStateFile, applyStateFromFile } from "./state-bridge.js";

export interface AgentRunnerConfig {
  /** URL of the agent-base HTTP server (e.g., http://localhost:3900) */
  agentUrl: string;
  /** Optional: URL of the farm dashboard for direct progress reporting */
  farmUrl?: string;
  /** Optional: agent ID for farm progress reporting */
  agentId?: string;
}

interface AgentMessageResponse {
  text: string;
  toolCalls: number;
  tokenUsage?: { input: number; output: number; cacheRead?: number };
  stderr?: string;
}

/**
 * Call agent-base's /eval/message endpoint.
 */
async function callAgent(agentUrl: string, message: string): Promise<AgentMessageResponse> {
  const res = await fetch(`${agentUrl}/eval/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(180_000), // 3 minute timeout
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Agent returned ${res.status}: ${body}`);
  }

  return await res.json() as AgentMessageResponse;
}

/**
 * Run the simulation using agent-base as the agent backend (HTTP mode).
 */
export async function runAgentSimulation(
  config: SimulationConfig,
  agentConfig: AgentRunnerConfig,
): Promise<RunResult> {
  const world = createVendingWorld(config.totalDays);
  world.simulationConfig = config;

  const runId = `run-${Date.now()}`;
  const stateFilePath = path.resolve(config.logDir, `${runId}-state.json`);
  const pluginDir = path.resolve(import.meta.dirname, "plugin");

  // Ensure log directory exists
  fs.mkdirSync(config.logDir, { recursive: true });

  console.log("═══════════════════════════════════════════");
  console.log("  Vending-Bench Simulation Starting");
  console.log(`  Mode: agent | Run: ${runId}`);
  console.log(`  Duration: ${config.totalDays} days`);
  console.log(`  Agent URL: ${agentConfig.agentUrl}`);
  console.log("═══════════════════════════════════════════\n");

  // Step 1: Configure agent-base with our plugin and workspace persona files
  const configureRes = await fetch(`${agentConfig.agentUrl}/eval/configure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pluginDir,
      stateFilePath,
      tools: [
        "send_email",
        "read_email",
        "search_engine",
        "get_storage_inventory",
        "stock_products",
        "check_money_balance",
        "collect_cash",
        "set_prices",
        "get_machine_inventory",
        "write_scratchpad",
        "read_scratchpad",
        "delete_scratchpad",
        "key_value_store",
        "wait_for_next_day",
      ],
      workspaceFiles: buildWorkspaceFiles(),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!configureRes.ok) {
    const body = await configureRes.text();
    throw new Error(`Failed to configure agent: ${configureRes.status}: ${body}`);
  }

  let totalLlmCalls = 0;
  let totalToolExecutions = 0;
  let totalEventsFired = 0;
  let daysCompleted = 0;
  const dailySnapshots: DailySnapshot[] = [];
  let prevSupplierSpend = 0;
  const startTime = Date.now();

  // Step 2: Send initial system context
  const systemContext = buildSystemPrompt() + "\n\nThis is Day 1. Get started!";
  writeStateFile(stateFilePath, world);
  console.log("Sending initial system context to agent (first LLM call, may take 30-60s)...");
  const initStart = Date.now();
  await callAgent(agentConfig.agentUrl, systemContext);
  console.log(`Initial context processed in ${((Date.now() - initStart) / 1000).toFixed(1)}s`);
  totalLlmCalls++;

  // Step 3: Day loop
  while (!world.isGameOver) {
    const dayNum = world.time.day;
    const netWorth = calculateScore(world).netWorth;
    console.log(
      `\n──── Day ${dayNum}/${config.totalDays} | Balance: $${world.balance.toFixed(2)} | Net Worth: $${netWorth.toFixed(2)} | Sold: ${world.totalItemsSold} ────`,
    );

    // 0. Process random events for the day
    const newEvents = processEventsForDay(world, config.eventTemperature, config.eventSeed);
    totalEventsFired += newEvents.length;
    if (newEvents.length > 0) {
      const eventsAvg = daysCompleted > 0 ? (totalEventsFired / daysCompleted).toFixed(2) : "0.00";
      console.log(`  Events: ${newEvents.length} today (${totalEventsFired} total, avg ${eventsAvg}/day)`);
    }

    // 1. Build morning notification
    const morningMsg = buildMorningNotif(world);

    // 2. Write current state to file for plugin tools
    writeStateFile(stateFilePath, world);

    // 3. Send morning notification to agent via HTTP
    const dayStart = Date.now();
    const response = await callAgent(agentConfig.agentUrl, morningMsg);
    const dayElapsed = ((Date.now() - dayStart) / 1000).toFixed(1);
    totalLlmCalls++;
    totalToolExecutions += response.toolCalls;

    // Log agent's text response
    const agentLines = response.text.split("\n").filter((l: string) => l.trim());
    for (const line of agentLines) {
      console.log(`  [AGENT] ${line}`);
    }

    // Log stderr if present
    if (response.stderr) {
      const stderrLines = response.stderr.split("\n").filter((l: string) => l.trim());
      for (const line of stderrLines) {
        if (line.includes("Config warnings") || line.includes("plugin id mismatch")) continue;
        console.log(`  [openclaw] ${line}`);
      }
    }

    console.log(`  (${response.toolCalls} tool calls, ${dayElapsed}s)`);

    // 4. Read back updated state from file
    applyStateFromFile(world, stateFilePath);

    // 5. Process sales (overnight)
    processDailySales(world);

    // 6. Process end-of-day (fees, deliveries, credits)
    processEndOfDay(world);

    // 7. Record daily snapshot
    const dayScore = calculateScore(world);
    const lastSales = world.salesHistory[world.salesHistory.length - 1];
    const dailySupplierSpend = world.totalSupplierSpend - prevSupplierSpend;
    prevSupplierSpend = world.totalSupplierSpend;
    let pendingDeliveryValue = 0;
    for (const d of world.pendingDeliveries) {
      pendingDeliveryValue += d.totalCost;
    }
    dailySnapshots.push({
      day: dayNum,
      netWorth: dayScore.netWorth,
      bankBalance: dayScore.bankBalance,
      machineCash: dayScore.machineCash,
      storageInventoryValue: dayScore.storageInventoryValue,
      machineInventoryValue: dayScore.machineInventoryValue,
      pendingCreditValue: dayScore.pendingCreditValue,
      pendingDeliveryValue: Math.round(pendingDeliveryValue * 100) / 100,
      dailyRevenue: lastSales?.totalRevenue ?? 0,
      dailyCashRevenue: lastSales?.cashRevenue ?? 0,
      dailyCreditRevenue: lastSales?.creditRevenue ?? 0,
      dailySupplierSpend,
      cumulativeRevenue: dayScore.totalRevenue,
      cumulativeSupplierSpend: dayScore.totalSupplierSpend,
      totalItemsSold: dayScore.totalItemsSold,
      activeEvents: world.activeEvents.length,
      eventsFiredToday: newEvents.length,
    });

    // 8. Advance to next day
    world.time.day++;
    world.time.minutesFromMidnight = 480; // 8am
    daysCompleted++;

    // 9. Checkpoint
    if (
      config.checkpointInterval > 0 &&
      dayNum % config.checkpointInterval === 0
    ) {
      saveCheckpoint(world, config, dayNum);
    }
  }

  const wallTimeSeconds = (Date.now() - startTime) / 1000;

  // Final score
  const score = calculateScore(world);
  console.log("\n" + formatScoreReport(score));
  console.log(`  Total LLM calls:    ${totalLlmCalls}`);
  console.log(`  Total tool calls:   ${totalToolExecutions}`);
  const finalEventsAvg = daysCompleted > 0 ? (totalEventsFired / daysCompleted).toFixed(2) : "0.00";
  console.log(`  Random events:      ${totalEventsFired} fired (avg ${finalEventsAvg}/day, active: ${world.activeEvents.length})`);
  console.log(`  Wall time:          ${wallTimeSeconds.toFixed(1)}s`);

  // Save final transcript
  const transcriptPath = path.join(
    config.logDir,
    `run-agent-${Date.now()}-transcript.json`,
  );
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify(
      {
        config,
        score,
        totalLlmCalls,
        totalToolExecutions,
        wallTimeSeconds,
        runId,
        events: {
          totalFired: totalEventsFired,
          avgPerDay: daysCompleted > 0 ? parseFloat((totalEventsFired / daysCompleted).toFixed(2)) : 0,
          activeAtEnd: world.activeEvents.length,
          history: world.eventHistory,
        },
        dailySnapshots,
      },
      null,
      2,
    ),
  );
  console.log(`\nTranscript saved to: ${transcriptPath}`);

  // Clean up state file
  try {
    fs.unlinkSync(stateFilePath);
  } catch {
    // ignore
  }

  return { score, totalLlmCalls, totalToolExecutions };
}

/**
 * Build workspace persona files for the vending agent.
 * These override openclaw's default assistant persona with the vending operator persona.
 * Adapted from _openclaw-reference/chat-handler.ts seedWorkspace().
 */
function buildWorkspaceFiles(): Record<string, string> {
  return {
    "AGENTS.md": `# Vending Machine Agent

You are a vending machine business operator in a simulation. Your ONLY job is to manage a vending machine business profitably over the simulated time period.

## How to Act

You have real tools available to you — use them via tool calls, NOT by writing their names in text.
When you want to search, call the search_engine tool. When you want to send email, call the send_email tool.
Do NOT write tool names as markdown bold text like **search_engine(...)** — that does nothing.

## Every Turn

1. Read the morning notification to understand the current day's state
2. Use your tools to take actions (search for suppliers, send emails, stock machine, set prices, etc.)
3. When done with your actions for the day, call wait_for_next_day

## Important

- You must USE your tools by calling them, not by writing about them
- Do not ask for permission or confirmation — just act
- Do not try to read files or use coding tools — you are a business operator, not a programmer
- Focus on: finding suppliers, ordering products, stocking the machine, setting prices, collecting cash
`,
    "SOUL.md": `# Vending Machine Operator

You are a pragmatic business operator. You make decisions quickly and take action.
You don't ask unnecessary questions. You use your tools directly.

When you receive a morning notification, you:
1. Review the state of your business
2. Take necessary actions using your available tools
3. End the day with wait_for_next_day

Be efficient. Be profitable. Use tools via tool calls, never as text.
`,
    "TOOLS.md": `# Vending Tools

Your primary tools for running the business:

- **search_engine**: Find suppliers and information
- **send_email / read_email**: Communicate with suppliers to order products
- **get_storage_inventory**: Check what's in your storage warehouse
- **stock_products**: Move products from storage to machine slots
- **set_prices**: Set prices for products in the machine
- **get_machine_inventory**: See what's currently in the machine
- **check_money_balance**: Check your bank balance and machine cash
- **collect_cash**: Collect cash from the machine to your bank account
- **write_scratchpad / read_scratchpad / delete_scratchpad**: Take notes
- **key_value_store**: Store/retrieve data persistently
- **wait_for_next_day**: End your actions for today and advance to the next day

CRITICAL: Call these tools using the tool calling mechanism. Do NOT write them as text.
`,
    "IDENTITY.md": `# Charles Paxton — Vending Machine Operator

- **Name:** Charles Paxton
- **Role:** Vending machine business operator
- **Location:** San Francisco
- **Goal:** Maximize net worth over the simulation period

You manage a vending machine business. You find suppliers, order products,
stock your machine, set competitive prices, and manage finances.

Machine: 6 rows x 4 columns = 24 slots (rows 1-3 small, rows 4-6 large).
Each slot holds 10 units. Daily rental fee: $2/day.
Starting balance: $500. 10+ unpaid days = bankruptcy.
`,
  };
}

function saveCheckpoint(
  world: VendingWorld,
  config: SimulationConfig,
  day: number,
): void {
  const checkpointPath = path.join(
    config.logDir,
    `checkpoint-agent-day-${day}.json`,
  );

  const serializable = {
    ...world,
    storageInventory: Object.fromEntries(world.storageInventory),
    machinePrices: Object.fromEntries(world.machinePrices),
    kvStore: Object.fromEntries(world.kvStore),
    simulationConfig: undefined,
  };

  fs.writeFileSync(checkpointPath, JSON.stringify(serializable, null, 2));
  console.log(`  [Checkpoint saved: Day ${day}]`);
}
