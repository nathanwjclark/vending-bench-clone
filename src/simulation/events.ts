/**
 * Random event system types, definitions, and catalog.
 *
 * Events create realistic disruptions and opportunities in the simulation:
 * supplier delays, demand surges, machine breakdowns, etc.
 */

import type { ProductCategory, ProductSize } from "./products.js";
import type { SupplierTier } from "./suppliers.js";

export type EventCategory = "supplier" | "consumer" | "machine";
export type EventTiming = "acute" | "systematic" | "market";
export type EventPolarity = "good" | "bad" | "neutral";

export interface DemandModifier {
  productFilter: {
    productIds?: string[];
    categories?: ProductCategory[];
    sizes?: ProductSize[];
  } | null; // null = all products
  multiplier: number; // 0.0 = no sales, 2.0 = double demand
}

export interface SupplierModifier {
  supplierFilter: {
    supplierIds?: string[];
    tiers?: SupplierTier[];
  } | null; // null = all suppliers
  extraDeliveryDays?: number;
  priceMultiplier?: number;
  unavailable?: boolean;
  removedProductIds?: string[];
}

export interface MachineModifier {
  offline?: boolean;
  loseUnits?: number;
  cashMechanismJammed?: boolean;
  repairCost?: number;
}

export interface EventDefinition {
  id: string;
  name: string;
  category: EventCategory;
  timing: EventTiming;
  polarity: EventPolarity;
  baseProbability: number; // per-day probability at temperature=1.0
  duration: { min: number; max: number }; // days
  earliestDay?: number;
  latestDay?: number;
  cooldownDays?: number;
  maxOccurrences?: number;
  demandModifiers?: DemandModifier[];
  supplierModifiers?: SupplierModifier[];
  machineModifier?: MachineModifier;
  notification: {
    morningMessage: string;
    email?: { from: string; subject: string; body: string };
    machineStatusMessage?: string;
    ongoingMorningMessage?: string;
  };
}

export interface ActiveEvent {
  eventDefId: string;
  startDay: number;
  endDay: number; // inclusive
  notified: boolean;
  resolvedParams: Record<string, number | string>;
}

/**
 * Initial event catalog — 5 example events to validate the framework.
 * Full catalog (30-50 events) will be added in Phase 2.
 */
export const EVENT_CATALOG: EventDefinition[] = [
  // 1. Machine Breakdown (machine/acute/bad)
  {
    id: "machine_breakdown",
    name: "Machine Breakdown",
    category: "machine",
    timing: "acute",
    polarity: "bad",
    baseProbability: 3 / 365, // ~3 per year
    duration: { min: 1, max: 3 },
    cooldownDays: 30,
    machineModifier: {
      offline: true,
      repairCost: 125, // mid-range of $75-175
    },
    notification: {
      morningMessage:
        "Your vending machine has broken down! A technician has been called. Repair cost: $125.00. The machine is offline until repairs are complete.",
      machineStatusMessage: "MACHINE OFFLINE — Awaiting repair",
      ongoingMorningMessage:
        "Your vending machine is still being repaired and remains offline.",
    },
  },

  // 2. Tourist Rush (consumer/acute/good)
  {
    id: "tourist_rush",
    name: "Tourist Rush",
    category: "consumer",
    timing: "acute",
    polarity: "good",
    baseProbability: 5 / 365, // ~5 per year
    duration: { min: 1, max: 3 },
    earliestDay: 121, // May 1 (month 4)
    latestDay: 273, // Sep 30 (month 8)
    cooldownDays: 14,
    demandModifiers: [
      {
        productFilter: null,
        multiplier: 1.8,
      },
    ],
    notification: {
      morningMessage:
        "A large group of tourists is visiting the Bay St area! Expect significantly higher foot traffic today.",
      ongoingMorningMessage:
        "Tourist activity remains high around your machine location.",
    },
  },

  // 3. Supplier Goes Out of Business (supplier/systematic/bad)
  {
    id: "supplier_out_of_business",
    name: "Supplier Goes Out of Business",
    category: "supplier",
    timing: "systematic",
    polarity: "bad",
    baseProbability: 2 / 365, // ~2 per year
    duration: { min: 365, max: 365 }, // permanent
    earliestDay: 60,
    maxOccurrences: 2,
    supplierModifiers: [
      {
        supplierFilter: null, // resolved at fire-time to specific supplier
        unavailable: true,
      },
    ],
    notification: {
      morningMessage:
        "Bad news — one of your suppliers has gone out of business and will no longer fulfill orders.",
      email: {
        from: "noreply@vendingops.com",
        subject: "Supplier Closure Notice",
        body: "We regret to inform you that a supplier you may have used has permanently closed their operations. Please find alternative suppliers for any products they carried.",
      },
    },
  },

  // 4. FDA Product Recall (supplier/market/bad)
  {
    id: "fda_product_recall",
    name: "FDA Product Recall",
    category: "supplier",
    timing: "market",
    polarity: "bad",
    baseProbability: 1 / 365, // ~1 per year
    duration: { min: 28, max: 56 },
    maxOccurrences: 1,
    cooldownDays: 90,
    demandModifiers: [
      {
        productFilter: { categories: ["snack"] }, // resolved at fire-time
        multiplier: 0,
      },
    ],
    supplierModifiers: [
      {
        supplierFilter: null,
        removedProductIds: [], // resolved at fire-time
      },
    ],
    notification: {
      morningMessage:
        "URGENT: The FDA has issued a recall on a product category. Affected products cannot be sold and suppliers have pulled them from their catalogs.",
      email: {
        from: "alerts@fda.gov",
        subject: "Mandatory Product Recall Notice",
        body: "The FDA has issued a mandatory recall affecting certain vending machine products due to a contamination concern. Affected products must be removed from sale immediately. Suppliers have been notified and will temporarily suspend sales of affected items.",
      },
      ongoingMorningMessage:
        "The FDA product recall remains in effect. Affected products are still unavailable.",
    },
  },

  // 5. Customer Refund Demand (consumer/acute/bad)
  {
    id: "customer_refund",
    name: "Customer Refund Demand",
    category: "consumer",
    timing: "acute",
    polarity: "bad",
    baseProbability: 8 / 365, // ~8 per year
    duration: { min: 1, max: 1 },
    cooldownDays: 7,
    machineModifier: {
      repairCost: 15, // mid-range of $5-25
    },
    notification: {
      morningMessage:
        "A customer is demanding a refund after their item got stuck in the machine. Cost: $15.00.",
      email: {
        from: "complaints@vendingops.com",
        subject: "Customer Complaint — Refund Issued",
        body: "A customer reported that a product got stuck in your vending machine. A refund of $15.00 has been automatically processed from your account. Consider checking the machine for jams.",
      },
    },
  },
];

/**
 * Find an event definition by ID.
 */
export function getEventDefById(id: string): EventDefinition | undefined {
  return EVENT_CATALOG.find((e) => e.id === id);
}
