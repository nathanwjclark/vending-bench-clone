/**
 * OpenClaw adapter — bridges the simulation runner with openclaw.
 *
 * This is the openclaw-mode equivalent of the direct-mode tool loop.
 * Instead of calling the LLM directly and executing tools in-process,
 * it delegates to openclaw via the ChatHandler, which invokes openclaw
 * as a subprocess with vending tools registered as a plugin.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SimulationConfig } from "../config.js";
import { processDailySales } from "../simulation/demand.js";
import { processEventsForDay } from "../simulation/event-scheduler.js";
import { calculateScore, formatScoreReport } from "../simulation/scoring.js";
import {
  createVendingWorld,
  processEndOfDay,
  type VendingWorld,
} from "../simulation/world.js";
import { buildSystemPrompt, buildMorningNotification as buildMorningNotif, type DailySnapshot, type RunResult } from "../runner.js";
import { ChatHandler, type ChatHandlerConfig } from "./chat-handler.js";
import { NativeMemoryBackend } from "./memory-backend.js";
import { writeStateFile, applyStateFromFile } from "./state-bridge.js";

export interface OpenClawAdapterConfig {
  /** Path to the openclaw installation directory */
  openclawDir: string;
  /** Base workspace directory for agent sessions */
  workspaceBaseDir: string;
}

/**
 * Run the simulation using openclaw as the agent backend.
 */
export async function runOpenClawSimulation(
  config: SimulationConfig,
  adapterConfig: OpenClawAdapterConfig,
): Promise<RunResult> {
  const world = createVendingWorld(config.totalDays);
  world.simulationConfig = config;

  const runId = `run-${Date.now()}`;
  const workspaceDir = path.join(adapterConfig.workspaceBaseDir, runId);
  const stateFilePath = path.join(workspaceDir, "vending-state.json");
  const pluginDir = path.resolve(
    path.join(import.meta.dirname, "plugin"),
  );

  // Create workspace
  fs.mkdirSync(workspaceDir, { recursive: true });

  // Set up ChatHandler with memory backend
  const backend = new NativeMemoryBackend();
  const chatConfig: ChatHandlerConfig = {
    openclawDir: adapterConfig.openclawDir,
    workspaceDir,
    sessionId: `vending-${runId}`,
    timeoutMs: 120_000,
    stateFilePath,
    pluginDir,
  };

  const chatHandler = new ChatHandler(chatConfig, backend);

  let totalLlmCalls = 0;
  let totalToolExecutions = 0;
  let totalEventsFired = 0;
  let daysCompleted = 0;
  const dailySnapshots: DailySnapshot[] = [];
  let prevSupplierSpend = 0;

  console.log("═══════════════════════════════════════════");
  console.log("  Vending-Bench Simulation Starting");
  console.log(`  Mode: openclaw | Run: ${runId}`);
  console.log(`  Duration: ${config.totalDays} days`);
  console.log(`  Workspace: ${workspaceDir}`);
  console.log("═══════════════════════════════════════════\n");

  // Ensure log directory exists
  fs.mkdirSync(config.logDir, { recursive: true });

  // Send initial system context as the first message
  const systemContext = buildSystemPrompt() + "\n\nThis is Day 1. Get started!";
  writeStateFile(stateFilePath, world);
  console.log("Sending initial system context to openclaw (first LLM call, may take 30-60s)...");
  const initStart = Date.now();
  await chatHandler.handleMessage(systemContext);
  console.log(`Initial context processed in ${((Date.now() - initStart) / 1000).toFixed(1)}s`);
  totalLlmCalls++;

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

    // 1. Build morning notification (uses central buildMorningNotification)
    const morningMsg = buildMorningNotif(world);

    // 2. Write current state to file for plugin tools
    writeStateFile(stateFilePath, world);

    // 3. Send morning notification to openclaw
    const dayStart = Date.now();
    const response = await chatHandler.handleMessage(morningMsg);
    const dayElapsed = ((Date.now() - dayStart) / 1000).toFixed(1);
    totalLlmCalls++;
    totalToolExecutions += response.toolCalls;

    // Log agent's text response (full, not truncated)
    const agentLines = response.text.split("\n").filter((l: string) => l.trim());
    for (const line of agentLines) {
      console.log(`  [AGENT] ${line}`);
    }

    // Log stderr (contains openclaw tool execution logs)
    if (response.stderr) {
      const stderrLines = response.stderr.split("\n").filter((l: string) => l.trim());
      for (const line of stderrLines) {
        // Skip noise like "Config warnings" but show tool-related logs
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

  // Final score
  const score = calculateScore(world);
  console.log("\n" + formatScoreReport(score));
  console.log(`  Total LLM calls:    ${totalLlmCalls}`);
  console.log(`  Total tool calls:   ${totalToolExecutions}`);
  const finalEventsAvg = daysCompleted > 0 ? (totalEventsFired / daysCompleted).toFixed(2) : "0.00";
  console.log(`  Random events:      ${totalEventsFired} fired (avg ${finalEventsAvg}/day, active: ${world.activeEvents.length})`);

  // Save final transcript
  const transcriptPath = path.join(
    config.logDir,
    `run-openclaw-${Date.now()}-transcript.json`,
  );
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify(
      {
        config,
        score,
        totalLlmCalls,
        totalToolExecutions,
        runId,
        workspaceDir,
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

  // Capture memory snapshot
  const snapshot = await backend.captureSnapshot();
  const snapshotPath = path.join(
    config.logDir,
    `run-openclaw-${Date.now()}-memory.json`,
  );
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  return { score, totalLlmCalls, totalToolExecutions };
}

function saveCheckpoint(
  world: VendingWorld,
  config: SimulationConfig,
  day: number,
): void {
  const checkpointPath = path.join(
    config.logDir,
    `checkpoint-openclaw-day-${day}.json`,
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
