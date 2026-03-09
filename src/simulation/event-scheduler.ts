/**
 * Event scheduler — processes random events each day.
 *
 * Called once per day before morning notification to:
 * 1. Expire ended events
 * 2. Roll for new events based on temperature and seed
 * 3. Apply one-time effects (repair costs, lost units)
 * 4. Return newly fired events for notification
 */

import { addToInbox } from "./email.js";
import {
  EVENT_CATALOG,
  getEventDefById,
  type ActiveEvent,
  type EventDefinition,
} from "./events.js";
import { SUPPLIER_CATALOG } from "./suppliers.js";
import { getProductById } from "./products.js";
import {
  AGENT_EMAIL,
  getMachineProducts,
  type VendingWorld,
} from "./world.js";

// --- Seeded PRNG ---

/** Simple deterministic hash (matches demand.ts pattern) */
function simpleHash(n: number): number {
  let h = n * 2654435761;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return Math.abs(h);
}

/** Hash a string to a number */
function stringHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash);
}

/** Seeded random [0, 1) for a specific day + event combination */
function seededRandom(seed: number, day: number, eventId: string): number {
  const combined = seed * 7919 + day * 104729 + stringHash(eventId);
  const h = simpleHash(combined);
  return (h % 10000) / 10000;
}

/** Seeded random integer in [min, max] (inclusive) */
function seededRandInt(
  seed: number,
  day: number,
  eventId: string,
  min: number,
  max: number,
): number {
  const r = seededRandom(seed, day, eventId + "_dur");
  return min + Math.floor(r * (max - min + 1));
}

// --- Core scheduler ---

/**
 * Process events for a given day. Call before morning notification.
 * Returns the list of newly fired events.
 */
export function processEventsForDay(
  world: VendingWorld,
  temperature: number,
  seed: number,
): ActiveEvent[] {
  if (temperature <= 0) return [];

  const day = world.time.day;

  // 1. Expire events where day > endDay
  world.activeEvents = world.activeEvents.filter((e) => day <= e.endDay);

  // 2. Roll for new events
  const newEvents: ActiveEvent[] = [];

  for (const eventDef of EVENT_CATALOG) {
    // Skip if already active
    if (world.activeEvents.some((e) => e.eventDefId === eventDef.id)) continue;

    // Skip if day out of range
    if (eventDef.earliestDay !== undefined && day < eventDef.earliestDay)
      continue;
    if (eventDef.latestDay !== undefined && day > eventDef.latestDay) continue;

    // Skip if max occurrences reached
    if (eventDef.maxOccurrences !== undefined) {
      const occurrences = world.eventHistory.filter(
        (h) => h.eventDefId === eventDef.id,
      ).length;
      if (occurrences >= eventDef.maxOccurrences) continue;
    }

    // Skip if cooldown not elapsed
    if (eventDef.cooldownDays !== undefined) {
      const lastOccurrence = world.eventHistory
        .filter((h) => h.eventDefId === eventDef.id)
        .sort((a, b) => b.endDay - a.endDay)[0];
      if (lastOccurrence && day - lastOccurrence.endDay < eventDef.cooldownDays)
        continue;
    }

    // Roll
    const effectiveProbability =
      eventDef.baseProbability * Math.sqrt(temperature);
    const roll = seededRandom(seed, day, eventDef.id);

    if (roll < effectiveProbability) {
      // Fire event
      const duration = seededRandInt(
        seed,
        day,
        eventDef.id,
        eventDef.duration.min,
        eventDef.duration.max,
      );
      const endDay = day + duration - 1;

      const activeEvent: ActiveEvent = {
        eventDefId: eventDef.id,
        startDay: day,
        endDay,
        notified: false,
        resolvedParams: {},
      };

      // Resolve supplier-specific params for "supplier_out_of_business"
      if (eventDef.id === "supplier_out_of_business") {
        const availableSuppliers = SUPPLIER_CATALOG.filter(
          (s) =>
            !world.activeEvents.some(
              (e) =>
                e.eventDefId === "supplier_out_of_business" &&
                e.resolvedParams["supplierId"] === s.id,
            ) &&
            !world.eventHistory.some(
              (h) =>
                h.eventDefId === "supplier_out_of_business" &&
                world.activeEvents.some(
                  (ae) =>
                    ae.eventDefId === h.eventDefId &&
                    ae.resolvedParams["supplierId"] === s.id,
                ),
            ),
        );
        if (availableSuppliers.length === 0) continue;
        const idx = simpleHash(seed + day * 31) % availableSuppliers.length;
        const targetSupplier = availableSuppliers[idx]!;
        activeEvent.resolvedParams["supplierId"] = targetSupplier.id;
        activeEvent.resolvedParams["supplierName"] = targetSupplier.name;
      }

      // Apply one-time effects
      applyOneTimeEffects(world, eventDef, activeEvent, seed, day);

      world.activeEvents.push(activeEvent);
      world.eventHistory.push({
        eventDefId: eventDef.id,
        startDay: day,
        endDay,
      });
      newEvents.push(activeEvent);

      // Queue email notification if defined
      if (eventDef.notification.email) {
        const emailNotif = eventDef.notification.email;
        addToInbox(world.email, {
          from: emailNotif.from,
          to: AGENT_EMAIL,
          subject: emailNotif.subject,
          body: emailNotif.body,
          day,
        });
      }
    }
  }

  return newEvents;
}

/**
 * Apply one-time effects when an event fires.
 */
function applyOneTimeEffects(
  world: VendingWorld,
  eventDef: EventDefinition,
  _activeEvent: ActiveEvent,
  seed: number,
  day: number,
): void {
  const mod = eventDef.machineModifier;
  if (!mod) return;

  // Deduct repair cost
  if (mod.repairCost) {
    world.balance -= mod.repairCost;
  }

  // Lose random units from machine
  if (mod.loseUnits && mod.loseUnits > 0) {
    const products = getMachineProducts(world);
    let unitsToLose = mod.loseUnits;
    for (const p of products) {
      if (unitsToLose <= 0) break;
      const slot = world.machineSlots[p.row]![p.col]!;
      const lose = Math.min(slot.quantity, unitsToLose);
      slot.quantity -= lose;
      unitsToLose -= lose;
    }
  }
}

// --- Helper functions for other modules ---

/**
 * Get the combined demand multiplier from all active events for a given product.
 */
export function getEventDemandMultiplier(
  world: VendingWorld,
  productId: string,
): number {
  let multiplier = 1.0;
  const product = getProductById(productId);

  for (const ae of world.activeEvents) {
    const def = getEventDefById(ae.eventDefId);
    if (!def?.demandModifiers) continue;

    for (const dm of def.demandModifiers) {
      if (dm.productFilter === null) {
        // Applies to all products
        multiplier *= dm.multiplier;
      } else {
        let matches = false;
        if (dm.productFilter.productIds?.includes(productId)) matches = true;
        if (product && dm.productFilter.categories?.includes(product.category))
          matches = true;
        if (product && dm.productFilter.sizes?.includes(product.size))
          matches = true;
        if (matches) multiplier *= dm.multiplier;
      }
    }
  }

  return multiplier;
}

/**
 * Get aggregated supplier modifiers for a given supplier.
 */
export function getActiveSupplierModifiers(
  world: VendingWorld,
  supplierId: string,
): {
  extraDeliveryDays: number;
  priceMultiplier: number;
  unavailable: boolean;
  removedProductIds: string[];
} {
  let extraDeliveryDays = 0;
  let priceMultiplier = 1.0;
  let unavailable = false;
  const removedProductIds: string[] = [];

  for (const ae of world.activeEvents) {
    const def = getEventDefById(ae.eventDefId);
    if (!def?.supplierModifiers) continue;

    for (const sm of def.supplierModifiers) {
      // Check if this modifier applies to the supplier
      let applies = false;
      if (sm.supplierFilter === null) {
        // For events with resolvedParams.supplierId, only apply to that supplier
        if (ae.resolvedParams["supplierId"]) {
          applies = ae.resolvedParams["supplierId"] === supplierId;
        } else {
          applies = true;
        }
      } else {
        if (sm.supplierFilter.supplierIds?.includes(supplierId)) applies = true;
        // Tier-based filtering would require looking up the supplier definition
      }

      if (applies) {
        if (sm.extraDeliveryDays) extraDeliveryDays += sm.extraDeliveryDays;
        if (sm.priceMultiplier) priceMultiplier *= sm.priceMultiplier;
        if (sm.unavailable) unavailable = true;
        if (sm.removedProductIds)
          removedProductIds.push(...sm.removedProductIds);
      }
    }
  }

  return { extraDeliveryDays, priceMultiplier, unavailable, removedProductIds };
}

/**
 * Check if the machine is offline due to any active event.
 */
export function isMachineOffline(world: VendingWorld): boolean {
  for (const ae of world.activeEvents) {
    const def = getEventDefById(ae.eventDefId);
    if (def?.machineModifier?.offline) return true;
  }
  return false;
}

/**
 * Check if the cash mechanism is jammed due to any active event.
 */
export function isCashJammed(world: VendingWorld): boolean {
  for (const ae of world.activeEvents) {
    const def = getEventDefById(ae.eventDefId);
    if (def?.machineModifier?.cashMechanismJammed) return true;
  }
  return false;
}

/**
 * Get machine status messages from active events.
 */
export function getMachineStatusMessages(world: VendingWorld): string[] {
  const messages: string[] = [];
  for (const ae of world.activeEvents) {
    const def = getEventDefById(ae.eventDefId);
    if (def?.notification.machineStatusMessage) {
      messages.push(def.notification.machineStatusMessage);
    }
  }
  return messages;
}
