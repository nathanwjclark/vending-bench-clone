/**
 * Core world state for the vending machine simulation.
 *
 * The VendingWorld tracks all simulation state:
 * - Financial: bank balance, machine cash
 * - Inventory: storage warehouse + vending machine slots
 * - Time: current day and time
 * - Orders: pending supplier deliveries
 * - Memory: agent's scratchpad and key-value store
 */

import { createEmailSystem, type EmailSystem } from "./email.js";
import type { ActiveEvent } from "./events.js";
import type { ProductSize } from "./products.js";
import { createInitialTimeState, type TimeState } from "./time.js";

/** Vending machine layout: 4 rows × 3 columns = 12 slots */
export const MACHINE_ROWS = 4;
export const MACHINE_COLS = 3;
export const MACHINE_TOTAL_SLOTS = MACHINE_ROWS * MACHINE_COLS;

/** Rows 1-2 are for small items, rows 3-4 for large items */
export const SMALL_ITEM_ROWS = [0, 1] as const;
export const LARGE_ITEM_ROWS = [2, 3] as const;

/** Items per slot (how many units fit behind one slot position) */
export const UNITS_PER_SLOT = 10;

export const DAILY_FEE = 2.0;
export const STARTING_BALANCE = 500.0;
export const MAX_UNPAID_DAYS = 10;
export const DEFAULT_TOTAL_DAYS = 365;

export const AGENT_EMAIL = "charles.paxton@vendingops.com";
export const STORAGE_ADDRESS = "1680 Mission St, San Francisco, CA 94103";
export const MACHINE_ADDRESS = "1421 Bay St, San Francisco, CA 94123";

/** A slot in the vending machine */
export interface MachineSlot {
  /** Product ID occupying this slot, or null if empty */
  productId: string | null;
  /** Number of units in this slot */
  quantity: number;
  /** Price per unit in dollars */
  price: number;
}

/** A pending delivery from a supplier */
export interface PendingDelivery {
  supplierId: string;
  items: Array<{ productId: string; quantity: number; unitCost: number }>;
  /** Day the delivery will arrive */
  arrivalDay: number;
  /** Total amount charged */
  totalCost: number;
}

/** Daily sales record */
export interface DailySalesRecord {
  day: number;
  sales: Array<{
    productId: string;
    productName: string;
    quantity: number;
    pricePerUnit: number;
    revenue: number;
  }>;
  totalRevenue: number;
  creditRevenue: number;
  cashRevenue: number;
  weather: string;
}

export interface VendingWorld {
  /** Financial state */
  balance: number;
  machineCash: number;
  /** Pending credit card deposits: { day: arrivalDay, amount: number } */
  pendingCredits: Array<{ day: number; amount: number }>;

  /** Inventory */
  storageInventory: Map<string, { quantity: number; avgUnitCost: number }>;
  machineSlots: MachineSlot[][];

  /** Machine price overrides (productId -> price) */
  machinePrices: Map<string, number>;

  /** Time */
  time: TimeState;
  totalDays: number;

  /** Orders & deliveries */
  pendingDeliveries: PendingDelivery[];

  /** Email */
  email: EmailSystem;

  /** Agent memory */
  scratchpad: string;
  kvStore: Map<string, string>;

  /** Game state */
  consecutiveUnpaidDays: number;
  isGameOver: boolean;
  gameOverReason: string | null;

  /** Events */
  activeEvents: ActiveEvent[];
  eventHistory: Array<{ eventDefId: string; startDay: number; endDay: number }>;

  /** History */
  salesHistory: DailySalesRecord[];
  totalItemsSold: number;
  totalRevenue: number;
  totalSupplierSpend: number;

  /** Runtime config reference (set by runner, used by tools that need config) */
  simulationConfig?: import("../config.js").SimulationConfig;

  /** Cost tracker (set by runner, used by email tools for supplier LLM calls) */
  costTracker?: import("../cost-tracker.js").CostTracker;
}

export function createVendingWorld(totalDays = DEFAULT_TOTAL_DAYS): VendingWorld {
  // Initialize 6×4 machine grid
  const machineSlots: MachineSlot[][] = [];
  for (let row = 0; row < MACHINE_ROWS; row++) {
    const rowSlots: MachineSlot[] = [];
    for (let col = 0; col < MACHINE_COLS; col++) {
      rowSlots.push({ productId: null, quantity: 0, price: 0 });
    }
    machineSlots.push(rowSlots);
  }

  return {
    balance: STARTING_BALANCE,
    machineCash: 0,
    pendingCredits: [],

    storageInventory: new Map(),
    machineSlots,
    machinePrices: new Map(),

    time: createInitialTimeState(),
    totalDays,

    pendingDeliveries: [],

    email: createEmailSystem(),

    scratchpad: "",
    kvStore: new Map(),

    consecutiveUnpaidDays: 0,
    isGameOver: false,
    gameOverReason: null,

    activeEvents: [],
    eventHistory: [],

    salesHistory: [],
    totalItemsSold: 0,
    totalRevenue: 0,
    totalSupplierSpend: 0,
  };
}

/**
 * Process end-of-day: deduct fee, process deliveries, process credit deposits.
 * Called when wait_for_next_day is used or day time runs out.
 *
 * Note: Sales are processed separately by the demand model before this is called.
 */
export function processEndOfDay(world: VendingWorld): void {
  // 1. Process credit card deposits arriving today
  const depositsToday = world.pendingCredits.filter(
    (c) => c.day <= world.time.day,
  );
  for (const deposit of depositsToday) {
    world.balance += deposit.amount;
  }
  world.pendingCredits = world.pendingCredits.filter(
    (c) => c.day > world.time.day,
  );

  // 2. Deduct daily fee
  if (world.balance >= DAILY_FEE) {
    world.balance -= DAILY_FEE;
    world.consecutiveUnpaidDays = 0;
  } else {
    world.consecutiveUnpaidDays++;
    if (world.consecutiveUnpaidDays >= MAX_UNPAID_DAYS) {
      world.isGameOver = true;
      world.gameOverReason = `Bankruptcy: unable to pay $${DAILY_FEE}/day fee for ${MAX_UNPAID_DAYS} consecutive days.`;
    }
  }

  // 3. Process deliveries arriving today
  const deliveriesToday = world.pendingDeliveries.filter(
    (d) => d.arrivalDay <= world.time.day,
  );
  for (const delivery of deliveriesToday) {
    for (const item of delivery.items) {
      const existing = world.storageInventory.get(item.productId);
      if (existing) {
        // Weighted average cost
        const totalQty = existing.quantity + item.quantity;
        const totalCost =
          existing.avgUnitCost * existing.quantity +
          item.unitCost * item.quantity;
        existing.quantity = totalQty;
        existing.avgUnitCost = totalQty > 0 ? totalCost / totalQty : 0;
      } else {
        world.storageInventory.set(item.productId, {
          quantity: item.quantity,
          avgUnitCost: item.unitCost,
        });
      }
    }
  }
  world.pendingDeliveries = world.pendingDeliveries.filter(
    (d) => d.arrivalDay > world.time.day,
  );

  // 4. Check if simulation is complete
  if (world.time.day >= world.totalDays) {
    world.isGameOver = true;
    world.gameOverReason = `Simulation complete: ${world.totalDays} days elapsed.`;
  }
}

/**
 * Get the allowed product size for a given machine row.
 */
export function getAllowedSizeForRow(row: number): ProductSize {
  return (SMALL_ITEM_ROWS as readonly number[]).includes(row)
    ? "small"
    : "large";
}

/**
 * Find a machine slot containing a specific product.
 */
export function findMachineSlot(
  world: VendingWorld,
  productId: string,
): { row: number; col: number; slot: MachineSlot } | null {
  for (let row = 0; row < MACHINE_ROWS; row++) {
    for (let col = 0; col < MACHINE_COLS; col++) {
      const slot = world.machineSlots[row]![col]!;
      if (slot.productId === productId) {
        return { row, col, slot };
      }
    }
  }
  return null;
}

/**
 * Find an empty machine slot suitable for a product of the given size.
 */
export function findEmptySlot(
  world: VendingWorld,
  size: ProductSize,
): { row: number; col: number } | null {
  const rows =
    size === "small"
      ? (SMALL_ITEM_ROWS as readonly number[])
      : (LARGE_ITEM_ROWS as readonly number[]);

  for (const row of rows) {
    for (let col = 0; col < MACHINE_COLS; col++) {
      const slot = world.machineSlots[row]![col]!;
      if (slot.productId === null) {
        return { row, col };
      }
    }
  }
  return null;
}

/**
 * Get all products currently in the machine with their quantities and prices.
 */
export function getMachineProducts(
  world: VendingWorld,
): Array<{ productId: string; row: number; col: number; quantity: number; price: number }> {
  const products: Array<{
    productId: string;
    row: number;
    col: number;
    quantity: number;
    price: number;
  }> = [];

  for (let row = 0; row < MACHINE_ROWS; row++) {
    for (let col = 0; col < MACHINE_COLS; col++) {
      const slot = world.machineSlots[row]![col]!;
      if (slot.productId !== null && slot.quantity > 0) {
        products.push({
          productId: slot.productId,
          row,
          col,
          quantity: slot.quantity,
          price: slot.price,
        });
      }
    }
  }

  return products;
}
