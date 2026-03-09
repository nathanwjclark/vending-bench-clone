/**
 * State bridge: serialize/deserialize VendingWorld to/from a JSON file.
 *
 * When running in openclaw mode, the vending tools execute inside openclaw's
 * process (via a plugin). Since the runner and openclaw are separate processes,
 * we use a shared state file for communication:
 *
 * 1. Runner serializes VendingWorld → state file
 * 2. OpenClaw plugin tools read/modify state file
 * 3. Runner reads back updated state from file
 */

import * as fs from "node:fs";
import type { ActiveEvent } from "./simulation/events.js";
import type { VendingWorld, MachineSlot, PendingDelivery, DailySalesRecord } from "./simulation/world.js";
import type { EmailSystem } from "./simulation/email.js";
import type { TimeState } from "./simulation/time.js";

/** JSON-safe representation of VendingWorld (Maps → plain objects) */
export interface SerializedWorld {
  balance: number;
  machineCash: number;
  pendingCredits: Array<{ day: number; amount: number }>;
  storageInventory: Record<string, { quantity: number; avgUnitCost: number }>;
  machineSlots: MachineSlot[][];
  machinePrices: Record<string, number>;
  time: TimeState;
  totalDays: number;
  pendingDeliveries: PendingDelivery[];
  email: EmailSystem;
  scratchpad: string;
  kvStore: Record<string, string>;
  consecutiveUnpaidDays: number;
  isGameOver: boolean;
  gameOverReason: string | null;
  activeEvents: ActiveEvent[];
  eventHistory: Array<{ eventDefId: string; startDay: number; endDay: number }>;
  salesHistory: DailySalesRecord[];
  totalItemsSold: number;
  totalRevenue: number;
  totalSupplierSpend: number;
}

/**
 * Serialize VendingWorld to a JSON-safe object.
 */
export function serializeWorld(world: VendingWorld): SerializedWorld {
  return {
    balance: world.balance,
    machineCash: world.machineCash,
    pendingCredits: [...world.pendingCredits],
    storageInventory: Object.fromEntries(world.storageInventory),
    machineSlots: world.machineSlots.map((row) =>
      row.map((slot) => ({ ...slot })),
    ),
    machinePrices: Object.fromEntries(world.machinePrices),
    time: { ...world.time },
    totalDays: world.totalDays,
    pendingDeliveries: world.pendingDeliveries.map((d) => ({
      ...d,
      items: d.items.map((i) => ({ ...i })),
    })),
    email: {
      inbox: world.email.inbox.map((e) => ({ ...e })),
      sent: world.email.sent.map((e) => ({ ...e })),
      nextId: world.email.nextId,
    },
    scratchpad: world.scratchpad,
    kvStore: Object.fromEntries(world.kvStore),
    activeEvents: world.activeEvents.map((e) => ({ ...e, resolvedParams: { ...e.resolvedParams } })),
    eventHistory: [...world.eventHistory],
    consecutiveUnpaidDays: world.consecutiveUnpaidDays,
    isGameOver: world.isGameOver,
    gameOverReason: world.gameOverReason,
    salesHistory: [...world.salesHistory],
    totalItemsSold: world.totalItemsSold,
    totalRevenue: world.totalRevenue,
    totalSupplierSpend: world.totalSupplierSpend,
  };
}

/**
 * Deserialize a JSON object back into VendingWorld, restoring Maps.
 */
export function deserializeWorld(data: SerializedWorld): VendingWorld {
  return {
    balance: data.balance,
    machineCash: data.machineCash,
    pendingCredits: data.pendingCredits,
    storageInventory: new Map(Object.entries(data.storageInventory)),
    machineSlots: data.machineSlots,
    machinePrices: new Map(Object.entries(data.machinePrices)),
    time: data.time,
    totalDays: data.totalDays,
    pendingDeliveries: data.pendingDeliveries,
    email: data.email,
    scratchpad: data.scratchpad,
    kvStore: new Map(Object.entries(data.kvStore)),
    activeEvents: data.activeEvents ?? [],
    eventHistory: data.eventHistory ?? [],
    consecutiveUnpaidDays: data.consecutiveUnpaidDays,
    isGameOver: data.isGameOver,
    gameOverReason: data.gameOverReason,
    salesHistory: data.salesHistory,
    totalItemsSold: data.totalItemsSold,
    totalRevenue: data.totalRevenue,
    totalSupplierSpend: data.totalSupplierSpend,
  };
}

/**
 * Write VendingWorld state to a file.
 */
export function writeStateFile(filePath: string, world: VendingWorld): void {
  const data = serializeWorld(world);
  fs.writeFileSync(filePath, JSON.stringify(data));
}

/**
 * Read VendingWorld state from a file.
 */
export function readStateFile(filePath: string): VendingWorld {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data: SerializedWorld = JSON.parse(raw);
  return deserializeWorld(data);
}

/**
 * Apply changes from a modified state file back to an existing VendingWorld.
 * This preserves the original object reference while updating all fields.
 */
export function applyStateFromFile(
  target: VendingWorld,
  filePath: string,
): void {
  const updated = readStateFile(filePath);

  target.balance = updated.balance;
  target.machineCash = updated.machineCash;
  target.pendingCredits = updated.pendingCredits;
  target.storageInventory = updated.storageInventory;
  target.machineSlots = updated.machineSlots;
  target.machinePrices = updated.machinePrices;
  target.time = updated.time;
  target.pendingDeliveries = updated.pendingDeliveries;
  target.email = updated.email;
  target.scratchpad = updated.scratchpad;
  target.kvStore = updated.kvStore;
  target.activeEvents = updated.activeEvents;
  target.eventHistory = updated.eventHistory;
  target.consecutiveUnpaidDays = updated.consecutiveUnpaidDays;
  target.isGameOver = updated.isGameOver;
  target.gameOverReason = updated.gameOverReason;
  target.salesHistory = updated.salesHistory;
  target.totalItemsSold = updated.totalItemsSold;
  target.totalRevenue = updated.totalRevenue;
  target.totalSupplierSpend = updated.totalSupplierSpend;
}
