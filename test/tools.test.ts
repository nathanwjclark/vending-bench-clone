import { describe, it, expect } from "vitest";
import { createVendingWorld, UNITS_PER_SLOT } from "../src/simulation/world.js";
import { ALL_TOOLS, getToolByName, getOpenAiToolDefs } from "../src/tools/index.js";
import { DEFAULT_CONFIG } from "../src/config.js";

function exec(toolName: string, params: Record<string, unknown> = {}) {
  const world = createVendingWorld();
  const tool = getToolByName(toolName)!;
  expect(tool).toBeDefined();
  const result = tool.execute(params, world);
  return { result: result as { output: string; endDay?: boolean }, world };
}

function execWith(toolName: string, world: ReturnType<typeof createVendingWorld>, params: Record<string, unknown> = {}) {
  const tool = getToolByName(toolName)!;
  return tool.execute(params, world) as { output: string; endDay?: boolean };
}

async function execWithAsync(toolName: string, world: ReturnType<typeof createVendingWorld>, params: Record<string, unknown> = {}) {
  const tool = getToolByName(toolName)!;
  return await Promise.resolve(tool.execute(params, world)) as { output: string; endDay?: boolean };
}

describe("Tool registry", () => {
  it("has 14 tools registered", () => {
    expect(ALL_TOOLS.length).toBe(14);
  });

  it("all tools have names and descriptions", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it("generates OpenAI function definitions", () => {
    const defs = getOpenAiToolDefs();
    expect(defs.length).toBe(14);
    for (const def of defs) {
      expect(def.type).toBe("function");
      expect(def.function.name).toBeTruthy();
    }
  });
});

describe("Memory tools", () => {
  it("write and read scratchpad", () => {
    const world = createVendingWorld();
    execWith("write_scratchpad", world, { content: "Buy more water" });
    const result = execWith("read_scratchpad", world);
    expect(result.output).toContain("Buy more water");
  });

  it("delete scratchpad", () => {
    const world = createVendingWorld();
    execWith("write_scratchpad", world, { content: "test" });
    execWith("delete_scratchpad", world);
    const result = execWith("read_scratchpad", world);
    expect(result.output).toContain("empty");
  });

  it("key_value_store set and get", () => {
    const world = createVendingWorld();
    execWith("key_value_store", world, { action: "set", key: "supplier", value: "Acme Co" });
    const result = execWith("key_value_store", world, { action: "get", key: "supplier" });
    expect(result.output).toContain("Acme Co");
  });

  it("key_value_store list", () => {
    const world = createVendingWorld();
    execWith("key_value_store", world, { action: "set", key: "a", value: "1" });
    execWith("key_value_store", world, { action: "set", key: "b", value: "2" });
    const result = execWith("key_value_store", world, { action: "list" });
    expect(result.output).toContain("2 entries");
    expect(result.output).toContain("a = 1");
  });

  it("key_value_store delete", () => {
    const world = createVendingWorld();
    execWith("key_value_store", world, { action: "set", key: "x", value: "y" });
    execWith("key_value_store", world, { action: "delete", key: "x" });
    const result = execWith("key_value_store", world, { action: "get", key: "x" });
    expect(result.output).toContain("not found");
  });
});

describe("Finance tools", () => {
  it("check_money_balance shows starting balance", () => {
    const { result } = exec("check_money_balance");
    expect(result.output).toContain("$500.00");
  });

  it("collect_cash transfers machine cash to bank", () => {
    const world = createVendingWorld();
    world.machineCash = 25.50;
    const result = execWith("collect_cash", world);
    expect(result.output).toContain("$25.50");
    expect(world.machineCash).toBe(0);
    expect(world.balance).toBe(525.50);
  });

  it("collect_cash with no cash", () => {
    const { result } = exec("collect_cash");
    expect(result.output).toContain("No cash");
  });
});

describe("Inventory tools", () => {
  it("get_storage_inventory when empty", () => {
    const { result } = exec("get_storage_inventory");
    expect(result.output).toContain("empty");
  });

  it("get_storage_inventory shows products", () => {
    const world = createVendingWorld();
    world.storageInventory.set("water_bottle", { quantity: 20, avgUnitCost: 0.5 });
    const result = execWith("get_storage_inventory", world);
    expect(result.output).toContain("Bottled Water");
    expect(result.output).toContain("20 units");
  });

  it("stock_products moves items from storage to machine", () => {
    const world = createVendingWorld();
    world.storageInventory.set("water_bottle", { quantity: 20, avgUnitCost: 0.5 });
    const result = execWith("stock_products", world, { product: "water_bottle", quantity: 8 });
    expect(result.output).toContain("Stocked 8");
    expect(world.storageInventory.get("water_bottle")!.quantity).toBe(12);
    // Check machine has the product
    let found = false;
    for (const row of world.machineSlots) {
      for (const slot of row) {
        if (slot.productId === "water_bottle") {
          expect(slot.quantity).toBe(8);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("stock_products rejects insufficient storage", () => {
    const world = createVendingWorld();
    world.storageInventory.set("water_bottle", { quantity: 3, avgUnitCost: 0.5 });
    const result = execWith("stock_products", world, { product: "water_bottle", quantity: 5 });
    expect(result.output).toContain("Error");
    expect(result.output).toContain("not enough");
  });

  it("stock_products adds to existing slot", () => {
    const world = createVendingWorld();
    world.storageInventory.set("water_bottle", { quantity: 20, avgUnitCost: 0.5 });
    execWith("stock_products", world, { product: "water_bottle", quantity: 5 });
    execWith("stock_products", world, { product: "water_bottle", quantity: 3 });
    // Should have 8 total in machine, 12 in storage
    expect(world.storageInventory.get("water_bottle")!.quantity).toBe(12);
  });

  it("stock_products rejects exceeding slot capacity", () => {
    const world = createVendingWorld();
    world.storageInventory.set("water_bottle", { quantity: 20, avgUnitCost: 0.5 });
    execWith("stock_products", world, { product: "water_bottle", quantity: 8 });
    const result = execWith("stock_products", world, { product: "water_bottle", quantity: 5 });
    expect(result.output).toContain("Error");
    expect(result.output).toContain("room");
  });
});

describe("Machine tools", () => {
  it("get_machine_inventory shows empty machine", () => {
    const { result } = exec("get_machine_inventory");
    expect(result.output).toContain("0/12 slots filled");
  });

  it("set_prices updates price for stocked product", () => {
    const world = createVendingWorld();
    world.storageInventory.set("water_bottle", { quantity: 10, avgUnitCost: 0.5 });
    execWith("stock_products", world, { product: "water_bottle", quantity: 5 });
    execWith("set_prices", world, { product: "water_bottle", price: 2.50 });
    // Verify price updated in machine
    let foundPrice = 0;
    for (const row of world.machineSlots) {
      for (const slot of row) {
        if (slot.productId === "water_bottle") {
          foundPrice = slot.price;
        }
      }
    }
    expect(foundPrice).toBe(2.50);
  });
});

describe("Email tools", () => {
  it("send_email adds to sent folder", async () => {
    const world = createVendingWorld();
    const result = await execWithAsync("send_email", world, {
      to: "supplier@example.com",
      subject: "Product inquiry",
      body: "What products do you offer?",
    });
    expect(result.output).toContain("Email sent");
    expect(world.email.sent.length).toBe(1);
  });

  it("send_email to known supplier triggers static response", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };
    const result = await execWithAsync("send_email", world, {
      to: "orders@bayareawholesale.com",
      subject: "Product catalog",
      body: "What products do you offer?",
    });
    expect(result.output).toContain("known supplier");
    expect(world.email.sent.length).toBe(1);
    // Supplier reply should be queued (same day — instant email)
    expect(world.email.inbox.length).toBe(1);
    expect(world.email.inbox[0]!.from).toBe("orders@bayareawholesale.com");
    expect(world.email.inbox[0]!.day).toBe(1); // same day
  });

  it("send_email order triggers delivery scheduling", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };
    world.balance = 500;
    const result = await execWithAsync("send_email", world, {
      to: "orders@bayareawholesale.com",
      subject: "Order",
      body: "I would like to order 20 units of water bottles and 15 units of cola please.",
    });
    expect(result.output).toContain("known supplier");
    // Order should have been processed: balance deducted, delivery scheduled
    expect(world.pendingDeliveries.length).toBeGreaterThan(0);
    expect(world.balance).toBeLessThan(500);
  });

  it("read_email shows empty inbox", () => {
    const { result } = exec("read_email");
    expect(result.output).toContain("empty");
  });
});

describe("Time tools", () => {
  it("wait_for_next_day returns endDay flag", () => {
    const { result } = exec("wait_for_next_day");
    expect(result.endDay).toBe(true);
    expect(result.output).toContain("Ending Day 1");
  });
});

describe("Search tool", () => {
  it("search_engine returns supplier results", async () => {
    const world = createVendingWorld();
    const result = await execWithAsync("search_engine", world, { query: "wholesale snack suppliers" });
    expect(result.output).toContain("result(s)");
    expect(result.output).toContain("Wholesale Vending Supplies");
  });
});
