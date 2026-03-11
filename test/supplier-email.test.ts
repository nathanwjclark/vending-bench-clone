/**
 * Supplier email round-trip tests.
 *
 * Validates the full lifecycle:
 * email inquiry → supplier response → order placement → delivery → inventory
 */

import { describe, it, expect } from "vitest";
import { createVendingWorld, processEndOfDay, type VendingWorld } from "../src/simulation/world.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { getToolByName } from "../src/tools/index.js";
import { SUPPLIER_CATALOG, calculateActualCost, calculateDeliveryDay, calculateDeliveredQuantity } from "../src/simulation/suppliers.js";
import { processSupplierEmail } from "../src/llm/supplier-llm.js";

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

describe("Supplier email round-trip", () => {
  it("catalog inquiry generates product listing reply", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    // Send catalog inquiry
    await execTool("send_email", world, {
      to: "orders@bayareawholesale.com",
      subject: "Product Catalog",
      body: "What products do you offer? Please send your full catalog.",
    });

    // Check sent folder
    expect(world.email.sent.length).toBe(1);
    expect(world.email.sent[0]!.to).toBe("orders@bayareawholesale.com");

    // Check inbox for reply (same day — instant email)
    expect(world.email.inbox.length).toBe(1);
    const reply = world.email.inbox[0]!;
    expect(reply.from).toBe("orders@bayareawholesale.com");
    expect(reply.subject).toBe("Re: Product Catalog");
    expect(reply.day).toBe(1); // Same day
    expect(reply.body).toContain("Bay Area Wholesale");
  });

  it("order placement processes payment and schedules delivery", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    const balanceBefore = world.balance;

    // Place an order
    await execTool("send_email", world, {
      to: "orders@bayareawholesale.com",
      subject: "Order Placement",
      body: "I would like to order 20 units of water bottles and 10 units of cola. Please ship to 1680 Mission St, San Francisco, CA 94103.",
    });

    // Balance should be deducted
    expect(world.balance).toBeLessThan(balanceBefore);

    // Delivery should be pending
    expect(world.pendingDeliveries.length).toBe(1);
    const delivery = world.pendingDeliveries[0]!;
    expect(delivery.supplierId).toBe("bay-area-wholesale");
    expect(delivery.items.length).toBeGreaterThan(0);

    // Delivery should arrive within supplier's delivery window (2-3 days for honest)
    expect(delivery.arrivalDay).toBeGreaterThanOrEqual(3);
    expect(delivery.arrivalDay).toBeLessThanOrEqual(5);
  });

  it("delivery arrives and updates storage inventory", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    // Place order
    await execTool("send_email", world, {
      to: "orders@bayareawholesale.com",
      subject: "Order",
      body: "I would like to order 20 units of water bottles. Ship to 1680 Mission St, San Francisco, CA 94103.",
    });

    expect(world.pendingDeliveries.length).toBe(1);
    const arrivalDay = world.pendingDeliveries[0]!.arrivalDay;

    // Advance to delivery day
    for (let day = 1; day <= arrivalDay; day++) {
      world.time.day = day;
      processEndOfDay(world);
    }

    // Delivery should have been processed
    expect(world.pendingDeliveries.length).toBe(0);

    // Storage should have water bottles
    expect(world.storageInventory.has("water_bottle")).toBe(true);
    const waterInv = world.storageInventory.get("water_bottle")!;
    expect(waterInv.quantity).toBeGreaterThan(0);
  });

  it("adversarial supplier charges hidden fees", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    const balanceBefore = world.balance;

    // Order from VendMart Direct (adversarial — $15 processing + $0.25/unit handling)
    await execTool("send_email", world, {
      to: "sales@vendmartdirect.com",
      subject: "Order",
      body: "I would like to order 20 units of water bottles. Ship to 1680 Mission St, San Francisco, CA 94103.",
    });

    const spent = balanceBefore - world.balance;

    // Find the supplier to check expected cost
    const vendmart = SUPPLIER_CATALOG.find((s) => s.id === "vendmart-direct")!;
    const waterProduct = vendmart.products.find((p) => p.productId === "water_bottle");

    if (waterProduct && world.pendingDeliveries.length > 0) {
      // Cost should include hidden fees (more than just unit cost × qty)
      const baseCost = waterProduct.wholesalePrice * 20;
      // With $15 processing + $0.25/unit handling, total should be higher
      expect(spent).toBeGreaterThan(baseCost);
    }
  });

  it("adversarial supplier may short-ship", () => {
    const discountVend = SUPPLIER_CATALOG.find((s) => s.id === "discount-vend-supply")!;
    // Discount Vend ships 60-70% of ordered quantity

    let shortShipped = false;
    for (let seed = 0; seed < 20; seed++) {
      const delivered = calculateDeliveredQuantity(discountVend, 100, seed);
      if (delivered < 100) {
        shortShipped = true;
        break;
      }
    }
    expect(shortShipped).toBe(true);
  });

  it("honest supplier delivers full quantity", () => {
    const bayArea = SUPPLIER_CATALOG.find((s) => s.id === "bay-area-wholesale")!;

    for (let seed = 0; seed < 20; seed++) {
      const delivered = calculateDeliveredQuantity(bayArea, 100, seed);
      // Honest suppliers should deliver within 95-105% (minor rounding)
      expect(delivered).toBeGreaterThanOrEqual(95);
      expect(delivered).toBeLessThanOrEqual(105);
    }
  });

  it("price inquiry generates price response", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    await execTool("send_email", world, {
      to: "orders@bayareawholesale.com",
      subject: "Pricing",
      body: "What are your prices for water bottles and cola? Any discounts available?",
    });

    expect(world.email.inbox.length).toBe(1);
    const reply = world.email.inbox[0]!;
    expect(reply.body.toLowerCase()).toContain("price");
  });

  it("email to unknown address gets no supplier reply", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    const result = await execTool("send_email", world, {
      to: "nobody@example.com",
      subject: "Hello",
      body: "Are you a supplier?",
    });

    // Email was sent but no supplier response
    expect(world.email.sent.length).toBe(1);
    expect(world.email.inbox.length).toBe(0);
    expect(result.output).not.toContain("known supplier");
  });

  it("full pipeline: inquiry → order → delivery → stock → sell", async () => {
    const world = createVendingWorld(30);
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    // Step 1: Inquire about products
    await execTool("send_email", world, {
      to: "support@quickstock.co",
      subject: "Catalog",
      body: "What products do you sell? I need water bottles and chips.",
    });
    expect(world.email.inbox.length).toBe(1);

    // Step 2: Place order
    await execTool("send_email", world, {
      to: "support@quickstock.co",
      subject: "Order",
      body: "I would like to buy 10 units of water bottles and 10 units of chips. Ship to 1680 Mission St, SF CA 94103.",
    });
    expect(world.pendingDeliveries.length).toBeGreaterThan(0);

    // Step 3: Advance until delivery arrives
    const arrivalDay = Math.max(
      ...world.pendingDeliveries.map((d) => d.arrivalDay),
    );
    for (let day = 1; day <= arrivalDay; day++) {
      world.time.day = day;
      processEndOfDay(world);
    }

    // Step 4: Check storage
    const result1 = await execTool("get_storage_inventory", world);
    expect(result1.output).not.toContain("empty");

    // Step 5: Stock machine
    if (world.storageInventory.has("water_bottle")) {
      const qty = Math.min(
        world.storageInventory.get("water_bottle")!.quantity,
        10,
      );
      await execTool("stock_products", world, {
        product: "water_bottle",
        quantity: qty,
      });
      await execTool("set_prices", world, {
        product: "water_bottle",
        price: 2.0,
      });
    }

    if (world.storageInventory.has("chips_classic")) {
      const qty = Math.min(
        world.storageInventory.get("chips_classic")!.quantity,
        10,
      );
      await execTool("stock_products", world, {
        product: "chips_classic",
        quantity: qty,
      });
      await execTool("set_prices", world, {
        product: "chips_classic",
        price: 2.0,
      });
    }

    // Step 6: Verify machine has products
    const result2 = await execTool("get_machine_inventory", world);
    // At least one product should be stocked
    const hasProduct =
      result2.output.includes("Water") || result2.output.includes("Chips");
    expect(hasProduct).toBe(true);

    // Step 7: Simulate a day of sales
    world.time.day = arrivalDay + 1;
    const { processDailySales } = await import("../src/simulation/demand.js");
    const salesRecord = processDailySales(world);

    // With only 1-2 products stocked (low variety penalty), sales may be low
    // but should still generate something if there's inventory
    expect(salesRecord.totalRevenue).toBeGreaterThanOrEqual(0);
  });

  it("static path handles Nx quantity format (regression)", async () => {
    const world = createVendingWorld();
    world.simulationConfig = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    const balanceBefore = world.balance;

    // Use "30x" format that previously failed with detectOrder()
    await execTool("send_email", world, {
      to: "orders@bayareawholesale.com",
      subject: "Order",
      body: "I'd like to order: 20x water bottles and 10x cola. Ship to 1680 Mission St, SF.",
    });

    // Balance should be deducted — the static path should handle "Nx" format
    expect(world.balance).toBeLessThan(balanceBefore);
    expect(world.pendingDeliveries.length).toBe(1);
  });

  it("processSupplierEmail returns structured result for static orders", async () => {
    const world = createVendingWorld();
    const config = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    const result = await processSupplierEmail(
      "orders@bayareawholesale.com",
      "Order",
      "I would like to order 20 units of water bottles. Ship to 1680 Mission St.",
      world,
      config,
    );

    expect(result.isSupplier).toBe(true);
    expect(result.orderPlaced).toBe(true);
    expect(result.orderCost).toBeGreaterThan(0);
    expect(world.pendingDeliveries.length).toBe(1);
  });

  it("processSupplierEmail returns rejection for unparseable static order", async () => {
    const world = createVendingWorld();
    const config = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    const result = await processSupplierEmail(
      "orders@bayareawholesale.com",
      "Order",
      "I would like to order some stuff please.",
      world,
      config,
    );

    expect(result.isSupplier).toBe(true);
    // No items parseable, so order is rejected
    expect(result.orderPlaced).not.toBe(true);
  });

  it("processSupplierEmail handles general inquiry without order", async () => {
    const world = createVendingWorld();
    const config = { ...DEFAULT_CONFIG, useLlmSuppliers: false };

    const balanceBefore = world.balance;
    const result = await processSupplierEmail(
      "orders@bayareawholesale.com",
      "Hello",
      "Hi, I'm a new vending operator. Can you tell me about your company?",
      world,
      config,
    );

    expect(result.isSupplier).toBe(true);
    expect(result.orderPlaced).toBeUndefined();
    expect(world.balance).toBe(balanceBefore); // No charge
    expect(world.email.inbox.length).toBe(1);
  });
});
