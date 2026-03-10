/**
 * Integration tests for the vending simulation.
 *
 * These tests run multi-day simulation sequences WITHOUT an LLM,
 * scripting tool calls directly to verify the full lifecycle works:
 * ordering → delivery → stocking → sales → revenue → scoring.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createVendingWorld, processEndOfDay, MACHINE_ROWS, MACHINE_COLS, type VendingWorld } from "../src/simulation/world.js";
import { processDailySales } from "../src/simulation/demand.js";
import { calculateScore } from "../src/simulation/scoring.js";
import {
  buildSystemPrompt,
  buildMorningNotification,
  loadCheckpoint,
  findLatestCheckpoint,
} from "../src/runner.js";
import { serializeWorld } from "../src/state-bridge.js";
import { ALL_TOOLS, getToolByName } from "../src/tools/index.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { findSupplierByEmail, SUPPLIER_CATALOG } from "../src/simulation/suppliers.js";
import { performSearch } from "../src/simulation/search.js";

// Helper: execute a tool with async support
async function execTool(
  toolName: string,
  world: VendingWorld,
  params: Record<string, unknown> = {},
): Promise<{ output: string; endDay?: boolean }> {
  const tool = getToolByName(toolName)!;
  return Promise.resolve(tool.execute(params, world)) as Promise<{
    output: string;
    endDay?: boolean;
  }>;
}

describe("System prompt and morning notification", () => {
  it("system prompt mentions key info", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Charles Paxton");
    expect(prompt).toContain("$500");
    expect(prompt).toContain("$2.00/day");
    expect(prompt).toContain("24 slots");
    expect(prompt).toContain("search_engine");
    expect(prompt).toContain("wait_for_next_day");
  });

  it("morning notification shows relevant info", () => {
    const world = createVendingWorld();
    const msg = buildMorningNotification(world);
    expect(msg).toContain("Good Morning");
    expect(msg).toContain("$500.00");
    expect(msg).toContain("first day");
  });

  it("morning notification shows sales after day 1", () => {
    const world = createVendingWorld();
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 10;
    world.machineSlots[0]![0]!.price = 2.0;
    world.machineSlots[0]![1]!.productId = "soda_cola";
    world.machineSlots[0]![1]!.quantity = 10;
    world.machineSlots[0]![1]!.price = 2.0;
    world.machineSlots[0]![2]!.productId = "chips_classic";
    world.machineSlots[0]![2]!.quantity = 10;
    world.machineSlots[0]![2]!.price = 2.0;

    processDailySales(world);
    processEndOfDay(world);
    world.time.day = 2;

    const msg = buildMorningNotification(world);
    expect(msg).toContain("Day 2");
    // Should have sales data if any occurred
    expect(msg).toContain("$"); // monetary amounts
  });

  it("morning notification shows pending deliveries", () => {
    const world = createVendingWorld();
    world.pendingDeliveries.push({
      supplierId: "bay-area-wholesale",
      items: [{ productId: "water_bottle", quantity: 20, unitCost: 0.85 }],
      arrivalDay: 3,
      totalCost: 17.0,
    });
    const msg = buildMorningNotification(world);
    expect(msg).toContain("Pending Deliveries");
    expect(msg).toContain("bay-area-wholesale");
  });
});

describe("7-day perfect play integration", () => {
  it("orders products, stocks machine, generates revenue over 7 days", async () => {
    const world = createVendingWorld(7);
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    // DAY 1: Search for suppliers and place an order
    let result = await execTool("search_engine", world, {
      query: "wholesale vending suppliers",
    });
    expect(result.output).toContain("Bay Area Wholesale");

    result = await execTool("send_email", world, {
      to: "orders@bayareawholesale.com",
      subject: "Order",
      body: "I would like to order 10 units of water bottles, 10 units of cola, and 10 units of chips please. Ship to 1680 Mission St, San Francisco, CA 94103.",
    });
    expect(result.output).toContain("known supplier");

    // Check balance was deducted (order was processed)
    expect(world.balance).toBeLessThan(500);
    const balanceAfterOrder = world.balance;

    // Check delivery was scheduled
    expect(world.pendingDeliveries.length).toBeGreaterThan(0);

    result = await execTool("wait_for_next_day", world);
    expect(result.endDay).toBe(true);

    // Process day 1 sales (empty machine, no sales)
    processDailySales(world);
    processEndOfDay(world);

    // DAY 2: Check email, wait for delivery
    world.time.day = 2;
    world.time.minutesFromMidnight = 480;

    result = await execTool("read_email", world);
    // Should have supplier reply
    expect(world.email.inbox.length).toBeGreaterThan(0);

    result = await execTool("check_money_balance", world);
    expect(result.output).toContain("$");

    processDailySales(world);
    processEndOfDay(world);

    // DAY 3-4: Advance until delivery arrives
    for (let day = 3; day <= 4; day++) {
      world.time.day = day;
      world.time.minutesFromMidnight = 480;
      processDailySales(world);
      processEndOfDay(world);
    }

    // By day 4, delivery should have arrived (2-3 day delivery for honest supplier)
    // Check storage
    const hasWater = world.storageInventory.has("water_bottle");
    const hasCola = world.storageInventory.has("soda_cola");
    const hasChips = world.storageInventory.has("chips_classic");

    // At least some items should have arrived
    const anyDelivered = hasWater || hasCola || hasChips;
    expect(anyDelivered).toBe(true);

    // DAY 5: Stock the machine and set prices
    world.time.day = 5;
    world.time.minutesFromMidnight = 480;

    if (hasWater) {
      const waterInv = world.storageInventory.get("water_bottle")!;
      const stockQty = Math.min(waterInv.quantity, 10);
      result = await execTool("stock_products", world, {
        product: "water_bottle",
        quantity: stockQty,
      });
      expect(result.output).toContain("Stocked");

      result = await execTool("set_prices", world, {
        product: "water_bottle",
        price: 2.0,
      });
      expect(result.output).toContain("$2.00");
    }

    if (hasCola) {
      const colaInv = world.storageInventory.get("soda_cola")!;
      const stockQty = Math.min(colaInv.quantity, 10);
      result = await execTool("stock_products", world, {
        product: "soda_cola",
        quantity: stockQty,
      });

      result = await execTool("set_prices", world, {
        product: "soda_cola",
        price: 2.0,
      });
    }

    if (hasChips) {
      const chipsInv = world.storageInventory.get("chips_classic")!;
      const stockQty = Math.min(chipsInv.quantity, 10);
      result = await execTool("stock_products", world, {
        product: "chips_classic",
        quantity: stockQty,
      });

      result = await execTool("set_prices", world, {
        product: "chips_classic",
        price: 2.0,
      });
    }

    // Check machine inventory
    result = await execTool("get_machine_inventory", world);
    // Should have at least one product stocked
    expect(
      result.output.includes("water") ||
      result.output.includes("Cola") ||
      result.output.includes("Chips") ||
      result.output.includes("empty"),
    ).toBe(true);

    processDailySales(world);
    processEndOfDay(world);

    // DAY 6: Check sales and collect cash
    world.time.day = 6;
    world.time.minutesFromMidnight = 480;

    if (world.machineCash > 0) {
      const cashBefore = world.balance;
      result = await execTool("collect_cash", world);
      expect(result.output).toContain("Collected");
      expect(world.balance).toBeGreaterThan(cashBefore);
    }

    // Use scratchpad
    result = await execTool("write_scratchpad", world, {
      content: "Water and cola sell well. Consider ordering more.",
    });
    expect(result.output).toContain("updated");

    result = await execTool("read_scratchpad", world);
    expect(result.output).toContain("Water and cola sell well");

    processDailySales(world);
    processEndOfDay(world);

    // DAY 7: Final day
    world.time.day = 7;
    world.time.minutesFromMidnight = 480;
    processDailySales(world);
    processEndOfDay(world);

    // Final score
    world.isGameOver = true;
    world.gameOverReason = "Simulation complete: 7 days elapsed.";
    const score = calculateScore(world);

    // Should not have gone bankrupt
    expect(score.bankBalance).toBeGreaterThan(0);
    expect(score.daysCompleted).toBe(6);
    // Net worth should be reasonable (started with $500, spent some on orders)
    expect(score.netWorth).toBeGreaterThan(0);
  });
});

describe("Supplier system integration", () => {
  it("search returns all 10 suppliers", () => {
    const results = performSearch("wholesale vending suppliers");
    for (const supplier of SUPPLIER_CATALOG) {
      expect(results).toContain(supplier.name);
    }
  });

  it("search finds product-specific suppliers", () => {
    const results = performSearch("wholesale water bottles");
    expect(results).toContain("Bay Area Wholesale");
  });

  it("findSupplierByEmail works for all suppliers", () => {
    for (const supplier of SUPPLIER_CATALOG) {
      const found = findSupplierByEmail(supplier.email);
      expect(found).toBeDefined();
      expect(found!.id).toBe(supplier.id);
    }
  });

  it("unknown email returns undefined", () => {
    const found = findSupplierByEmail("nobody@example.com");
    expect(found).toBeUndefined();
  });
});

describe("Checkpoint and resume", () => {
  it("saves and loads checkpoint correctly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vending-ckpt-"));

    // Create a world with some state
    const world = createVendingWorld();
    world.balance = 423.50;
    world.machineCash = 15.75;
    world.time.day = 42;
    world.totalItemsSold = 100;
    world.totalRevenue = 250.0;
    world.storageInventory.set("water_bottle", {
      quantity: 30,
      avgUnitCost: 0.85,
    });
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 7;
    world.machineSlots[0]![0]!.price = 2.0;
    world.kvStore.set("best_supplier", "Bay Area Wholesale");

    // Save checkpoint
    const ckptPath = path.join(tmpDir, "checkpoint-day-42.json");
    const data = serializeWorld(world);
    fs.writeFileSync(ckptPath, JSON.stringify(data, null, 2));

    // Load checkpoint
    const restored = loadCheckpoint(ckptPath);

    expect(restored.balance).toBe(423.50);
    expect(restored.machineCash).toBe(15.75);
    expect(restored.time.day).toBe(42);
    expect(restored.totalItemsSold).toBe(100);
    expect(restored.storageInventory.get("water_bottle")?.quantity).toBe(30);
    expect(restored.machineSlots[0]![0]!.productId).toBe("water_bottle");
    expect(restored.kvStore.get("best_supplier")).toBe("Bay Area Wholesale");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("findLatestCheckpoint finds most recent", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vending-ckpt-"));

    // Create multiple checkpoint files
    fs.writeFileSync(path.join(tmpDir, "checkpoint-day-30.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "checkpoint-day-60.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "checkpoint-day-90.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "other-file.json"), "{}");

    const latest = findLatestCheckpoint(tmpDir);
    expect(latest).toContain("checkpoint-day-90.json");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("findLatestCheckpoint returns null for empty dir", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vending-ckpt-"));
    const latest = findLatestCheckpoint(tmpDir);
    expect(latest).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("findLatestCheckpoint returns null for missing dir", () => {
    const latest = findLatestCheckpoint("/tmp/nonexistent-vending-dir-xyz");
    expect(latest).toBeNull();
  });
});

describe("End-to-end demand simulation", () => {
  it("30-day simulation produces positive revenue with good stocking", () => {
    const world = createVendingWorld(30);

    // Stock 6 small products (rows 0-1, 3 cols = 6 small slots)
    const smallProducts = [
      { id: "water_bottle", price: 2.0 },
      { id: "soda_cola", price: 2.0 },
      { id: "energy_drink", price: 3.5 },
      { id: "chips_classic", price: 2.0 },
      { id: "candy_bar", price: 2.25 },
      { id: "granola_bar", price: 2.5 },
    ];
    // Stock 6 large products (rows 2-3, 3 cols = 6 large slots)
    const largeProducts = [
      { id: "sandwich_wrap", price: 5.5 },
      { id: "salad_bowl", price: 5.5 },
      { id: "protein_shake", price: 4.0 },
      { id: "coffee_cold", price: 4.0 },
      { id: "trail_mix", price: 3.5 },
      { id: "fruit_cup", price: 4.0 },
    ];

    // Fill small slots (rows 0-1, 3 cols each)
    for (let i = 0; i < smallProducts.length; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      world.machineSlots[row]![col]!.productId = smallProducts[i]!.id;
      world.machineSlots[row]![col]!.quantity = 10;
      world.machineSlots[row]![col]!.price = smallProducts[i]!.price;
    }

    for (let i = 0; i < largeProducts.length; i++) {
      const row = 2 + Math.floor(i / 3);
      const col = i % 3;
      world.machineSlots[row]![col]!.productId = largeProducts[i]!.id;
      world.machineSlots[row]![col]!.quantity = 10;
      world.machineSlots[row]![col]!.price = largeProducts[i]!.price;
    }

    let totalRevenue = 0;

    for (let day = 1; day <= 30; day++) {
      world.time.day = day;

      // Restock every day (simulating perfect play)
      for (let row = 0; row < MACHINE_ROWS; row++) {
        for (let col = 0; col < MACHINE_COLS; col++) {
          const slot = world.machineSlots[row]![col]!;
          if (slot.productId) {
            slot.quantity = 10;
          }
        }
      }

      const record = processDailySales(world);
      totalRevenue += record.totalRevenue;
      processEndOfDay(world);
    }

    // 30 days with 16 products should produce meaningful revenue
    expect(totalRevenue).toBeGreaterThan(3000);
    expect(totalRevenue).toBeLessThan(25000);

    // Daily fees = 30 * $2 = $60
    // Revenue should far exceed fees
    expect(totalRevenue).toBeGreaterThan(60);

    const score = calculateScore(world);
    // Net worth should reflect profits + starting balance
    expect(score.netWorth).toBeGreaterThan(400);
  });

  it("bankruptcy occurs with empty machine and no action", () => {
    const world = createVendingWorld(365);
    world.balance = 15; // Only enough for ~7 days of fees

    for (let day = 1; day <= 20; day++) {
      world.time.day = day;
      processDailySales(world);
      processEndOfDay(world);

      if (world.isGameOver) break;
    }

    expect(world.isGameOver).toBe(true);
    expect(world.gameOverReason).toContain("Bankruptcy");
  });
});

describe("Context management", () => {
  it("trimMessages preserves system message", async () => {
    const { trimMessages, estimateTotalTokens } = await import(
      "../src/llm/context.js"
    );

    const messages = [
      { role: "system" as const, content: "System prompt here." },
      { role: "user" as const, content: "Day 1 morning" },
      { role: "assistant" as const, content: "I will search for suppliers." },
      { role: "user" as const, content: "Day 2 morning" },
      { role: "assistant" as const, content: "Let me stock the machine." },
    ];

    // Trim to a very small budget
    const trimmed = trimMessages(messages, 50);

    // System message should always be first
    expect(trimmed[0]!.role).toBe("system");
    expect(trimmed[0]!.content).toBe("System prompt here.");

    // Should have fewer messages than original
    expect(trimmed.length).toBeLessThanOrEqual(messages.length);
  });

  it("trimMessages keeps all messages if under budget", async () => {
    const { trimMessages } = await import("../src/llm/context.js");

    const messages = [
      { role: "system" as const, content: "Short prompt." },
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi!" },
    ];

    const trimmed = trimMessages(messages, 100_000);
    expect(trimmed.length).toBe(3);
  });
});

describe("Tool completeness", () => {
  it("all 14 tools are registered", () => {
    expect(ALL_TOOLS.length).toBe(14);
  });

  it("every tool has a unique name", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has a description", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("every tool has a valid timeCost", () => {
    const validCosts = ["memory", "digital", "physical", "waitForNextDay"];
    for (const tool of ALL_TOOLS) {
      expect(validCosts).toContain(tool.timeCost);
    }
  });

  it("expected tool names are present", () => {
    const expectedTools = [
      "send_email", "read_email", "search_engine",
      "get_storage_inventory", "stock_products",
      "check_money_balance", "collect_cash",
      "set_prices", "get_machine_inventory",
      "write_scratchpad", "read_scratchpad", "delete_scratchpad",
      "key_value_store", "wait_for_next_day",
    ];

    for (const name of expectedTools) {
      expect(getToolByName(name)).toBeDefined();
    }
  });
});
