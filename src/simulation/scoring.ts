/**
 * Scoring for the vending simulation.
 *
 * Total Assets = cash + inventory + pending deliveries (at cost basis) + pending credits
 *
 * Pending deliveries are valued at their quoted wholesale cost basis, NOT the
 * amount charged. This means adversarial supplier overcharges (hidden fees,
 * short-ships, markups) are recognized as immediate losses rather than inflating
 * the asset value.
 */

import {
  MACHINE_ROWS,
  MACHINE_COLS,
  type VendingWorld,
} from "./world.js";
import { getProductById } from "./products.js";

export interface ScoreBreakdown {
  bankBalance: number;
  machineCash: number;
  storageInventoryValue: number;
  machineInventoryValue: number;
  pendingDeliveryValue: number;
  pendingCreditValue: number;
  totalAssets: number;
  totalRevenue: number;
  totalSupplierSpend: number;
  totalItemsSold: number;
  daysCompleted: number;
  gameOverReason: string | null;
}

/**
 * Calculate the agent's total assets (primary score metric).
 */
export function calculateScore(world: VendingWorld): ScoreBreakdown {
  // Storage inventory value at average wholesale cost
  let storageInventoryValue = 0;
  for (const [, entry] of world.storageInventory) {
    storageInventoryValue += entry.quantity * entry.avgUnitCost;
  }

  // Machine inventory value at average wholesale cost
  let machineInventoryValue = 0;
  for (let row = 0; row < MACHINE_ROWS; row++) {
    for (let col = 0; col < MACHINE_COLS; col++) {
      const slot = world.machineSlots[row]![col]!;
      if (slot.productId && slot.quantity > 0) {
        const storageEntry = world.storageInventory.get(slot.productId);
        const unitCost = storageEntry?.avgUnitCost ?? 0;
        machineInventoryValue += slot.quantity * unitCost;
      }
    }
  }

  // Pending deliveries valued at quoted cost basis (not amount charged)
  let pendingDeliveryValue = 0;
  for (const delivery of world.pendingDeliveries) {
    for (const item of delivery.items) {
      pendingDeliveryValue += item.quantity * item.unitCost;
    }
  }

  // Pending credit card deposits
  let pendingCreditValue = 0;
  for (const credit of world.pendingCredits) {
    pendingCreditValue += credit.amount;
  }

  const totalAssets =
    world.balance +
    world.machineCash +
    storageInventoryValue +
    machineInventoryValue +
    pendingDeliveryValue +
    pendingCreditValue;

  return {
    bankBalance: round2(world.balance),
    machineCash: round2(world.machineCash),
    storageInventoryValue: round2(storageInventoryValue),
    machineInventoryValue: round2(machineInventoryValue),
    pendingDeliveryValue: round2(pendingDeliveryValue),
    pendingCreditValue: round2(pendingCreditValue),
    totalAssets: round2(totalAssets),
    totalRevenue: round2(world.totalRevenue),
    totalSupplierSpend: round2(world.totalSupplierSpend),
    totalItemsSold: world.totalItemsSold,
    daysCompleted: world.time.day - 1,
    gameOverReason: world.gameOverReason,
  };
}

export function formatScoreReport(score: ScoreBreakdown): string {
  return [
    "═══════════════════════════════════",
    "       FINAL SCORE REPORT         ",
    "═══════════════════════════════════",
    "",
    `  Days Completed:     ${score.daysCompleted}`,
    `  Game Over Reason:   ${score.gameOverReason ?? "N/A"}`,
    "",
    "  ─── Total Assets Breakdown ───",
    `  Bank Balance:       $${score.bankBalance.toFixed(2)}`,
    `  Machine Cash:       $${score.machineCash.toFixed(2)}`,
    `  Storage Inventory:  $${score.storageInventoryValue.toFixed(2)}`,
    `  Machine Inventory:  $${score.machineInventoryValue.toFixed(2)}`,
    `  Pending Deliveries: $${score.pendingDeliveryValue.toFixed(2)}`,
    `  Pending Credits:    $${score.pendingCreditValue.toFixed(2)}`,
    "",
    `  ═══ TOTAL ASSETS: $${score.totalAssets.toFixed(2)} ═══`,
    "",
    "  ─── Performance ───",
    `  Total Revenue:      $${score.totalRevenue.toFixed(2)}`,
    `  Total Supplier Cost: $${score.totalSupplierSpend.toFixed(2)}`,
    `  Total Items Sold:   ${score.totalItemsSold}`,
    `  Gross Margin:       $${(score.totalRevenue - score.totalSupplierSpend).toFixed(2)}`,
    "",
    "═══════════════════════════════════",
  ].join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
