/**
 * Simulation runner — the main orchestration loop.
 *
 * For each day:
 * 1. Generate morning notification (sales, weather, emails)
 * 2. Run the tool-use loop (agent takes actions)
 * 3. Process sales (demand model)
 * 4. Process end-of-day (fees, deliveries, credits)
 * 5. Check game over conditions
 */

import type { SimulationConfig } from "./config.js";
import { CostTracker } from "./cost-tracker.js";
import {
  processDailySales,
  formatSalesReport,
  generateWeather,
} from "./simulation/demand.js";
import { getUnreadEmails } from "./simulation/email.js";
import { getEventDefById } from "./simulation/events.js";
import { processEventsForDay } from "./simulation/event-scheduler.js";
import { calculateScore, formatScoreReport } from "./simulation/scoring.js";
import {
  createVendingWorld,
  processEndOfDay,
  AGENT_EMAIL,
  STORAGE_ADDRESS,
  MACHINE_ADDRESS,
  type VendingWorld,
} from "./simulation/world.js";
import { formatDayTime, createInitialTimeState } from "./simulation/time.js";
import { runToolLoop } from "./llm/tool-loop.js";
import type { ChatMessage } from "./llm/client.js";
import {
  serializeWorld,
  deserializeWorld,
  type SerializedWorld,
} from "./state-bridge.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Build the system prompt for the agent.
 */
export function buildSystemPrompt(): string {
  return `You are Charles Paxton, an entrepreneur managing a vending machine business in San Francisco.

YOUR SITUATION:
- You have a vending machine at ${MACHINE_ADDRESS}
- You have a storage facility at ${STORAGE_ADDRESS}
- Your bank account starts with $500.00
- You pay a $2.00/day machine rental fee
- If you can't pay the fee for 10 consecutive days, you go bankrupt

YOUR GOAL:
Maximize your total assets (bank balance + machine cash + inventory value + pending deliveries + pending credits) over the next year (365 days).

HOW THE BUSINESS WORKS:
1. FIND SUPPLIERS: Use search_engine to find wholesale suppliers for snacks and drinks
2. ORDER PRODUCTS: Email suppliers to inquire about products and place orders
3. RECEIVE DELIVERIES: Orders arrive at your storage facility in 2-5 days
4. STOCK MACHINE: Move products from storage to the vending machine (24 slots: 12 small, 12 large)
5. SET PRICES: Set retail prices for each product
6. EARN REVENUE: Customers buy products. 70% paid by credit card (deposited next day), 30% cash (stays in machine until collected)
7. COLLECT CASH: Regularly collect cash from the machine

VENDING MACHINE:
- 6 rows × 4 columns = 24 slots
- Rows 1-3: small items (drinks, snacks, candy)
- Rows 4-6: large items (sandwiches, salads, shakes)
- Each slot holds up to 10 units of one product

IMPORTANT — BUSINESS REALITIES:
Running a vending business comes with real-world challenges. Suppliers can be unreliable or even adversarial — they may delay shipments, raise prices unexpectedly, or go under entirely. Customers aren't always happy, and equipment doesn't last forever. Market disruptions happen. Plan ahead, maintain cash reserves, diversify your suppliers, and always have a backup plan.

TIPS:
- Start by searching for suppliers and placing orders
- Keep the machine well-stocked with a variety of products
- Monitor sales to understand what sells well
- Collect cash regularly
- Use the scratchpad to keep notes and plans
- Adjust prices based on demand
- Be cautious with unknown suppliers — some may be unreliable

Your email address is: ${AGENT_EMAIL}
Your storage address is: ${STORAGE_ADDRESS}
Your machine address is: ${MACHINE_ADDRESS}

Each morning you'll receive a sales report. Take actions throughout the day, then call wait_for_next_day when you're done.`;
}

/**
 * Build the morning notification message for a given day.
 */
export function buildMorningNotification(world: VendingWorld): string {
  const weather = generateWeather(world.time.day);
  const unread = getUnreadEmails(world.email, world.time.day);

  const lines = [
    `══════ Good Morning! ${formatDayTime(world.time)} ══════`,
    `Weather today: ${weather}`,
    `Bank Balance: $${world.balance.toFixed(2)}`,
    `Machine Cash: $${world.machineCash.toFixed(2)}`,
  ];

  // Yesterday's sales
  const yesterdaySales = world.salesHistory[world.salesHistory.length - 1];
  if (yesterdaySales) {
    lines.push("", formatSalesReport(yesterdaySales));
  } else if (world.time.day === 1) {
    lines.push("", "This is your first day. Your vending machine is empty — time to find suppliers and stock up!");
  }

  // Unread emails
  if (unread.length > 0) {
    lines.push(`\nYou have ${unread.length} unread email(s).`);
  }

  // Pending deliveries
  if (world.pendingDeliveries.length > 0) {
    lines.push("\nPending Deliveries:");
    for (const d of world.pendingDeliveries) {
      lines.push(`  Arriving Day ${d.arrivalDay} from ${d.supplierId}`);
    }
  }

  // Event alerts
  for (const ae of world.activeEvents) {
    const def = getEventDefById(ae.eventDefId);
    if (!def) continue;

    if (!ae.notified) {
      lines.push(`\n[ALERT] ${def.notification.morningMessage}`);
      ae.notified = true;
    } else if (def.notification.ongoingMorningMessage && ae.endDay > world.time.day) {
      lines.push(
        `\n[NOTICE] ${def.notification.ongoingMorningMessage} (resolves Day ${ae.endDay})`,
      );
    }
  }

  // Warnings
  if (world.consecutiveUnpaidDays > 0) {
    lines.push(
      `\nWARNING: ${world.consecutiveUnpaidDays} consecutive unpaid day(s). Bankruptcy at 10!`,
    );
  }

  lines.push("\nWhat would you like to do today?");
  return lines.join("\n");
}

export interface DailySnapshot {
  day: number;
  totalAssets: number;
  bankBalance: number;
  machineCash: number;
  storageInventoryValue: number;
  machineInventoryValue: number;
  pendingCreditValue: number;
  pendingDeliveryValue: number;
  dailyRevenue: number;
  dailyCashRevenue: number;
  dailyCreditRevenue: number;
  dailySupplierSpend: number;
  cumulativeRevenue: number;
  cumulativeSupplierSpend: number;
  totalItemsSold: number;
  activeEvents: number;
  eventsFiredToday: number;
}

export interface RunResult {
  score: ReturnType<typeof calculateScore>;
  totalLlmCalls: number;
  totalToolExecutions: number;
}

/**
 * Load world state from a checkpoint file.
 */
export function loadCheckpoint(checkpointPath: string): VendingWorld {
  const raw = fs.readFileSync(checkpointPath, "utf-8");
  const data: SerializedWorld = JSON.parse(raw);
  return deserializeWorld(data);
}

/**
 * Find the most recent checkpoint file in a log directory.
 */
export function findLatestCheckpoint(logDir: string): string | null {
  if (!fs.existsSync(logDir)) return null;

  const files = fs.readdirSync(logDir)
    .filter((f) => f.startsWith("checkpoint-day-") && f.endsWith(".json"))
    .sort((a, b) => {
      const dayA = parseInt(a.match(/checkpoint-day-(\d+)/)?.[1] ?? "0", 10);
      const dayB = parseInt(b.match(/checkpoint-day-(\d+)/)?.[1] ?? "0", 10);
      return dayB - dayA; // Most recent first
    });

  return files.length > 0 ? path.join(logDir, files[0]!) : null;
}

/**
 * Run the full simulation.
 */
export async function runSimulation(
  config: SimulationConfig,
  resumeFrom?: string,
): Promise<RunResult> {
  let world: VendingWorld;
  let startDay: number;

  if (resumeFrom) {
    console.log(`Loading checkpoint: ${resumeFrom}`);
    world = loadCheckpoint(resumeFrom);
    world.simulationConfig = config;
    // Advance to next day from where we left off
    world.time.day++;
    world.time.minutesFromMidnight = 480; // 8am
    startDay = world.time.day;
    console.log(`Resuming from Day ${startDay}`);
  } else {
    world = createVendingWorld(config.totalDays);
    world.simulationConfig = config;
    startDay = 1;
  }

  const costTracker = new CostTracker({
    model: config.model,
    supplierModel: config.supplierModel,
    logDir: config.logDir,
  });
  world.costTracker = costTracker;

  const messages: ChatMessage[] = [];
  let totalLlmCalls = 0;
  let totalToolExecutions = 0;

  // System prompt
  messages.push({ role: "system", content: buildSystemPrompt() });

  if (resumeFrom) {
    // Add a context message so the agent knows it's resuming
    const score = calculateScore(world);
    messages.push({
      role: "user",
      content: `[System] Simulation resuming from Day ${startDay}. Current total assets: $${score.totalAssets.toFixed(2)}. Balance: $${world.balance.toFixed(2)}. Items sold so far: ${world.totalItemsSold}.`,
    });
  }

  // Ensure log directory exists
  fs.mkdirSync(config.logDir, { recursive: true });

  const startTime = Date.now();

  console.log("═══════════════════════════════════════════");
  console.log("  Vending-Bench Simulation");
  console.log(`  Mode: ${config.mode} | Model: ${config.model}`);
  console.log(`  Duration: ${config.totalDays} days`);
  if (resumeFrom) {
    console.log(`  Resumed from: ${resumeFrom} (Day ${startDay})`);
  }
  console.log("═══════════════════════════════════════════\n");

  let daysCompleted = 0;
  let totalEventsFired = 0;
  const dailySnapshots: DailySnapshot[] = [];
  let prevSupplierSpend = 0;

  while (!world.isGameOver) {
    const dayNum = world.time.day;
    const elapsedSec = (Date.now() - startTime) / 1000;
    const elapsed = elapsedSec.toFixed(0);
    const totalAssets = calculateScore(world).totalAssets;

    // Time estimate
    let etaStr = "";
    if (daysCompleted > 0) {
      const secPerDay = elapsedSec / daysCompleted;
      const daysRemaining = config.totalDays - dayNum;
      const etaSec = secPerDay * daysRemaining;
      etaStr = ` | ETA: ${formatDuration(etaSec)}`;
    }

    const costSummary = costTracker.formatSummary();
    console.log(
      `\n──── Day ${dayNum}/${config.totalDays} | Balance: $${world.balance.toFixed(2)} | Total Assets: $${totalAssets.toFixed(2)} | Sold: ${world.totalItemsSold} | ${elapsed}s elapsed${etaStr} | ${costSummary} ────`,
    );

    // 0. Process random events for the day
    const newEvents = processEventsForDay(world, config.eventTemperature, config.eventSeed);
    totalEventsFired += newEvents.length;
    const eventsAvg = daysCompleted > 0 ? (totalEventsFired / daysCompleted).toFixed(2) : "0.00";
    const eventsStr = `Events: ${newEvents.length} today (${totalEventsFired} total, avg ${eventsAvg}/day)`;
    if (newEvents.length > 0) {
      console.log(`  ${eventsStr}`);
    }

    // 1. Morning notification
    const morningMsg = buildMorningNotification(world);
    messages.push({ role: "user", content: morningMsg });

    // 2. Run tool loop (agent takes actions)
    const loopResult = await runToolLoop(world, messages, config, costTracker);
    totalLlmCalls += loopResult.llmCalls;
    totalToolExecutions += loopResult.toolExecutions;

    // 3. Process sales (overnight)
    processDailySales(world);

    // 4. Process end-of-day (fees, deliveries, credits)
    processEndOfDay(world);

    // 5. Advance to next morning.
    // wait_for_next_day already advances via advanceTime(), so only
    // advance here if the day ended due to time running out.
    if (world.time.day === dayNum) {
      world.time.day++;
      world.time.minutesFromMidnight = 480; // 8 AM
    }

    // Record daily snapshot (after sales + end-of-day processing)
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
      totalAssets: dayScore.totalAssets,
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

    daysCompleted++;

    // 5. Checkpoint
    if (
      config.checkpointInterval > 0 &&
      dayNum % config.checkpointInterval === 0
    ) {
      saveCheckpoint(world, config, dayNum);
    }
  }

  const totalElapsedSec = (Date.now() - startTime) / 1000;
  const totalElapsed = totalElapsedSec.toFixed(1);

  // Finalize cost tracking
  const lastDay = world.time.day;
  const costEntry = costTracker.finalize(lastDay);

  // Final score
  const score = calculateScore(world);
  console.log("\n" + formatScoreReport(score));
  console.log(`  Total LLM calls:    ${totalLlmCalls}`);
  console.log(`  Total tool calls:   ${totalToolExecutions}`);
  console.log(`  Wall time:          ${formatDuration(totalElapsedSec)} (${totalElapsed}s)`);
  console.log(`  Messages generated: ${messages.length}`);
  const finalEventsAvg = daysCompleted > 0 ? (totalEventsFired / daysCompleted).toFixed(2) : "0.00";
  console.log(`  Random events:      ${totalEventsFired} fired (avg ${finalEventsAvg}/day, active: ${world.activeEvents.length})`);
  console.log(`  Est. API cost:      $${costEntry.estimatedCostUsd.toFixed(4)}`);
  console.log(`    Agent tokens:     ${(costEntry.agentInputTokens / 1000).toFixed(1)}k in / ${(costEntry.agentOutputTokens / 1000).toFixed(1)}k out (${costEntry.agentCalls} calls)`);
  if (costEntry.supplierCalls > 0) {
    console.log(`    Supplier tokens:  ${(costEntry.supplierInputTokens / 1000).toFixed(1)}k in / ${(costEntry.supplierOutputTokens / 1000).toFixed(1)}k out (${costEntry.supplierCalls} calls)`);
  }

  // 365-day projection
  if (daysCompleted > 0 && daysCompleted < 365) {
    const costPerDay = costEntry.estimatedCostUsd / daysCompleted;
    const timePerDay = totalElapsedSec / daysCompleted;
    const projected365Cost = costPerDay * 365;
    const projected365Time = timePerDay * 365;

    console.log(`\n  ── 365-Day Projection (based on ${daysCompleted} days) ──`);
    console.log(`  Est. total cost:    $${projected365Cost.toFixed(2)}`);
    console.log(`  Est. total time:    ${formatDuration(projected365Time)}`);
    console.log(`  Avg cost/day:       $${costPerDay.toFixed(4)}`);
    console.log(`  Avg time/day:       ${formatDuration(timePerDay)}`);
  }

  console.log(`\nCumulative cost log: ${path.join(config.logDir, "cost-log.json")}`);

  // Save final transcript
  const transcriptPath = path.join(
    config.logDir,
    `run-${Date.now()}-transcript.json`,
  );
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify(
      {
        config,
        score,
        cost: costEntry,
        totalLlmCalls,
        totalToolExecutions,
        messageCount: messages.length,
        wallTimeSeconds: parseFloat(totalElapsed),
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

  return { score, totalLlmCalls, totalToolExecutions };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function saveCheckpoint(
  world: VendingWorld,
  config: SimulationConfig,
  day: number,
): void {
  const checkpointPath = path.join(
    config.logDir,
    `checkpoint-day-${day}.json`,
  );

  const data = serializeWorld(world);
  fs.writeFileSync(checkpointPath, JSON.stringify(data, null, 2));
  console.log(`  [Checkpoint saved: Day ${day}]`);
}
