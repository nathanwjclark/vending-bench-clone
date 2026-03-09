import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createVendingWorld } from "../src/simulation/world.js";
import {
  serializeWorld,
  deserializeWorld,
  writeStateFile,
  readStateFile,
  applyStateFromFile,
} from "../src/state-bridge.js";

describe("State bridge serialization", () => {
  it("round-trips VendingWorld through serialize/deserialize", () => {
    const world = createVendingWorld();
    world.balance = 423.50;
    world.machineCash = 15.75;
    world.storageInventory.set("water_bottle", {
      quantity: 20,
      avgUnitCost: 0.85,
    });
    world.kvStore.set("supplier", "Bay Area Wholesale");
    world.scratchpad = "Buy more water";

    // Stock a slot
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 8;
    world.machineSlots[0]![0]!.price = 2.0;

    const serialized = serializeWorld(world);
    const restored = deserializeWorld(serialized);

    expect(restored.balance).toBe(423.50);
    expect(restored.machineCash).toBe(15.75);
    expect(restored.storageInventory.get("water_bottle")?.quantity).toBe(20);
    expect(restored.kvStore.get("supplier")).toBe("Bay Area Wholesale");
    expect(restored.scratchpad).toBe("Buy more water");
    expect(restored.machineSlots[0]![0]!.productId).toBe("water_bottle");
    expect(restored.machineSlots[0]![0]!.quantity).toBe(8);
    expect(restored.machineSlots[0]![0]!.price).toBe(2.0);
  });

  it("round-trips through file I/O", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vending-test-"));
    const filePath = path.join(tmpDir, "state.json");

    const world = createVendingWorld();
    world.balance = 100;
    world.storageInventory.set("chips_classic", {
      quantity: 50,
      avgUnitCost: 0.60,
    });

    writeStateFile(filePath, world);
    const restored = readStateFile(filePath);

    expect(restored.balance).toBe(100);
    expect(restored.storageInventory.get("chips_classic")?.quantity).toBe(50);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("applyStateFromFile updates target world in place", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vending-test-"));
    const filePath = path.join(tmpDir, "state.json");

    // Create a "modified" world and write to file
    const modified = createVendingWorld();
    modified.balance = 999;
    modified.machineCash = 50;
    modified.totalItemsSold = 42;
    writeStateFile(filePath, modified);

    // Apply to a fresh world
    const target = createVendingWorld();
    expect(target.balance).toBe(500); // Default starting balance
    applyStateFromFile(target, filePath);
    expect(target.balance).toBe(999);
    expect(target.machineCash).toBe(50);
    expect(target.totalItemsSold).toBe(42);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("preserves email system through serialization", () => {
    const world = createVendingWorld();
    world.email.inbox.push({
      id: "inbox-1",
      from: "supplier@test.com",
      to: "agent@test.com",
      subject: "Quote",
      body: "Here are our prices...",
      day: 2,
      read: false,
    });

    const serialized = serializeWorld(world);
    const restored = deserializeWorld(serialized);

    expect(restored.email.inbox.length).toBe(1);
    expect(restored.email.inbox[0]!.from).toBe("supplier@test.com");
    expect(restored.email.inbox[0]!.read).toBe(false);
  });

  it("preserves pending deliveries", () => {
    const world = createVendingWorld();
    world.pendingDeliveries.push({
      supplierId: "bay-area-wholesale",
      items: [{ productId: "water_bottle", quantity: 20, unitCost: 0.85 }],
      arrivalDay: 5,
      totalCost: 17.0,
    });

    const serialized = serializeWorld(world);
    const restored = deserializeWorld(serialized);

    expect(restored.pendingDeliveries.length).toBe(1);
    expect(restored.pendingDeliveries[0]!.supplierId).toBe("bay-area-wholesale");
    expect(restored.pendingDeliveries[0]!.items[0]!.quantity).toBe(20);
  });
});
