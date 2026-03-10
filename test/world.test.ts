import { describe, it, expect } from "vitest";
import {
  createVendingWorld,
  processEndOfDay,
  findEmptySlot,
  findMachineSlot,
  getMachineProducts,
  getAllowedSizeForRow,
  DAILY_FEE,
  STARTING_BALANCE,
  MAX_UNPAID_DAYS,
  MACHINE_ROWS,
  MACHINE_COLS,
  UNITS_PER_SLOT,
} from "../src/simulation/world.js";
import { advanceTime } from "../src/simulation/time.js";

describe("VendingWorld", () => {
  it("creates with correct initial state", () => {
    const world = createVendingWorld();
    expect(world.balance).toBe(STARTING_BALANCE);
    expect(world.machineCash).toBe(0);
    expect(world.time.day).toBe(1);
    expect(world.isGameOver).toBe(false);
    expect(world.storageInventory.size).toBe(0);
    expect(world.machineSlots.length).toBe(MACHINE_ROWS);
    expect(world.machineSlots[0]!.length).toBe(MACHINE_COLS);
  });

  it("deducts daily fee on end of day", () => {
    const world = createVendingWorld();
    processEndOfDay(world);
    expect(world.balance).toBe(STARTING_BALANCE - DAILY_FEE);
    expect(world.consecutiveUnpaidDays).toBe(0);
  });

  it("tracks consecutive unpaid days when balance is insufficient", () => {
    const world = createVendingWorld();
    world.balance = 0;
    processEndOfDay(world);
    expect(world.consecutiveUnpaidDays).toBe(1);
    expect(world.isGameOver).toBe(false);
  });

  it("triggers bankruptcy after MAX_UNPAID_DAYS consecutive failures", () => {
    const world = createVendingWorld();
    world.balance = 0;
    for (let i = 0; i < MAX_UNPAID_DAYS; i++) {
      processEndOfDay(world);
    }
    expect(world.consecutiveUnpaidDays).toBe(MAX_UNPAID_DAYS);
    expect(world.isGameOver).toBe(true);
    expect(world.gameOverReason).toContain("Bankruptcy");
  });

  it("resets unpaid counter when fee is paid", () => {
    const world = createVendingWorld();
    world.balance = 0;
    processEndOfDay(world); // unpaid day 1
    processEndOfDay(world); // unpaid day 2
    expect(world.consecutiveUnpaidDays).toBe(2);
    world.balance = 100;
    processEndOfDay(world); // paid
    expect(world.consecutiveUnpaidDays).toBe(0);
  });

  it("processes deliveries on arrival day", () => {
    const world = createVendingWorld();
    world.pendingDeliveries.push({
      supplierId: "supplier-1",
      items: [{ productId: "water_bottle", quantity: 20, unitCost: 0.5 }],
      arrivalDay: 1,
      totalCost: 10,
    });
    processEndOfDay(world);
    const storage = world.storageInventory.get("water_bottle");
    expect(storage).toBeDefined();
    expect(storage!.quantity).toBe(20);
    expect(storage!.avgUnitCost).toBe(0.5);
  });

  it("merges deliveries with existing storage using weighted average cost", () => {
    const world = createVendingWorld();
    world.storageInventory.set("water_bottle", {
      quantity: 10,
      avgUnitCost: 0.4,
    });
    world.pendingDeliveries.push({
      supplierId: "supplier-1",
      items: [{ productId: "water_bottle", quantity: 10, unitCost: 0.6 }],
      arrivalDay: 1,
      totalCost: 6,
    });
    processEndOfDay(world);
    const storage = world.storageInventory.get("water_bottle");
    expect(storage!.quantity).toBe(20);
    expect(storage!.avgUnitCost).toBe(0.5); // (10*0.4 + 10*0.6) / 20
  });

  it("processes pending credit deposits", () => {
    const world = createVendingWorld();
    world.pendingCredits.push({ day: 1, amount: 50 });
    processEndOfDay(world);
    // Balance should be: 500 + 50 (credit) - 2 (fee) = 548
    expect(world.balance).toBe(548);
    expect(world.pendingCredits.length).toBe(0);
  });

  it("ends simulation after totalDays", () => {
    const world = createVendingWorld(5);
    world.time.day = 5;
    processEndOfDay(world);
    expect(world.isGameOver).toBe(true);
    expect(world.gameOverReason).toContain("Simulation complete");
  });
});

describe("Machine slots", () => {
  it("getAllowedSizeForRow returns correct sizes", () => {
    // 4×3 machine: rows 0-1 small, rows 2-3 large
    expect(getAllowedSizeForRow(0)).toBe("small");
    expect(getAllowedSizeForRow(1)).toBe("small");
    expect(getAllowedSizeForRow(2)).toBe("large");
    expect(getAllowedSizeForRow(3)).toBe("large");
  });

  it("findEmptySlot finds slot for small items in rows 0-1", () => {
    const world = createVendingWorld();
    const slot = findEmptySlot(world, "small");
    expect(slot).not.toBeNull();
    expect(slot!.row).toBeLessThanOrEqual(1);
  });

  it("findEmptySlot finds slot for large items in rows 2-3", () => {
    const world = createVendingWorld();
    const slot = findEmptySlot(world, "large");
    expect(slot).not.toBeNull();
    expect(slot!.row).toBeGreaterThanOrEqual(2);
  });

  it("findEmptySlot returns null when all slots of size are full", () => {
    const world = createVendingWorld();
    // Fill all small slots (rows 0-1, 3 cols each = 6 slots)
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < MACHINE_COLS; col++) {
        world.machineSlots[row]![col]!.productId = `product_${row}_${col}`;
        world.machineSlots[row]![col]!.quantity = 5;
      }
    }
    const slot = findEmptySlot(world, "small");
    expect(slot).toBeNull();
  });

  it("findMachineSlot locates a stocked product", () => {
    const world = createVendingWorld();
    world.machineSlots[1]![2]!.productId = "soda_cola";
    world.machineSlots[1]![2]!.quantity = 5;
    world.machineSlots[1]![2]!.price = 1.5;

    const result = findMachineSlot(world, "soda_cola");
    expect(result).not.toBeNull();
    expect(result!.row).toBe(1);
    expect(result!.col).toBe(2);
    expect(result!.slot.quantity).toBe(5);
  });

  it("getMachineProducts returns all stocked products", () => {
    const world = createVendingWorld();
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 8;
    world.machineSlots[0]![0]!.price = 2.0;
    world.machineSlots[2]![1]!.productId = "sandwich_wrap";
    world.machineSlots[2]![1]!.quantity = 3;
    world.machineSlots[2]![1]!.price = 5.0;

    const products = getMachineProducts(world);
    expect(products.length).toBe(2);
    expect(products.find((p) => p.productId === "water_bottle")).toBeDefined();
    expect(products.find((p) => p.productId === "sandwich_wrap")).toBeDefined();
  });
});
