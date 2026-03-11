/**
 * Inventory tools: view storage, stock products into machine.
 */

import { getProductById } from "../simulation/products.js";
import {
  findEmptySlot,
  findMachineSlot,
  UNITS_PER_SLOT,
  type VendingWorld,
} from "../simulation/world.js";
import type { ToolDefinition } from "./types.js";

export const getStorageInventory: ToolDefinition = {
  name: "get_storage_inventory",
  description:
    "Check the inventory at your storage facility (1680 Mission St). Shows all products and quantities available to stock in the vending machine.",
  parameters: {},
  timeCost: "digital",
  execute(_params, world) {
    if (world.storageInventory.size === 0) {
      return { output: "Storage is empty. Order products from suppliers to fill it." };
    }

    const lines = ["Storage Inventory (1680 Mission St):"];
    for (const [productId, entry] of world.storageInventory) {
      const product = getProductById(productId);
      const name = product?.name ?? productId;
      lines.push(
        `  ${name} [${productId}]: ${entry.quantity} units (avg cost: $${entry.avgUnitCost.toFixed(2)}/unit)`,
      );
    }

    if (world.pendingDeliveries.length > 0) {
      lines.push("", "Incoming Deliveries:");
      for (const delivery of world.pendingDeliveries) {
        const itemSummary = delivery.items
          .map((i) => {
            const p = getProductById(i.productId);
            return `${p?.name ?? i.productId} ×${i.quantity}`;
          })
          .join(", ");
        lines.push(`  Day ${delivery.arrivalDay}: ${itemSummary}`);
      }
    }

    return { output: lines.join("\n") };
  },
};

export const stockProducts: ToolDefinition = {
  name: "stock_products",
  description:
    "Move products from your storage facility into the vending machine. The machine has 24 slots (6 rows × 4 columns). Rows 1-3 hold small items, rows 4-6 hold large items. Each slot holds up to 10 units of one product.",
  parameters: {
    product: {
      type: "string",
      description:
        "The product ID or name to stock (e.g. 'water_bottle' or 'Bottled Water').",
    },
    quantity: {
      type: "number",
      description:
        "Number of units to move from storage to machine (max 10 per slot).",
    },
  },
  timeCost: "physical",
  execute(params, world) {
    const productQuery = String(params["product"] ?? "");
    const quantity = Number(params["quantity"] ?? 0);

    if (!productQuery) {
      return { output: "Error: please specify a product to stock." };
    }
    if (quantity <= 0 || !Number.isInteger(quantity)) {
      return { output: "Error: quantity must be a positive integer." };
    }

    // Find the product
    const product = getProductById(productQuery) ??
      getProductById(productQuery.toLowerCase());
    if (!product) {
      return { output: `Error: product "${productQuery}" not found. Use get_storage_inventory to see available products.` };
    }

    // Check storage
    const storageEntry = world.storageInventory.get(product.id);
    if (!storageEntry || storageEntry.quantity < quantity) {
      const available = storageEntry?.quantity ?? 0;
      return {
        output: `Error: not enough in storage. You have ${available} units of ${product.name}, but tried to stock ${quantity}.`,
      };
    }

    // Find or create a machine slot for this product
    let existingSlot = findMachineSlot(world, product.id);

    if (existingSlot) {
      // Add to existing slot
      const spaceLeft = UNITS_PER_SLOT - existingSlot.slot.quantity;
      if (quantity > spaceLeft) {
        return {
          output: `Error: slot only has room for ${spaceLeft} more units (current: ${existingSlot.slot.quantity}/${UNITS_PER_SLOT}).`,
        };
      }
      existingSlot.slot.quantity += quantity;
    } else {
      // Find empty slot of correct size
      const emptySlot = findEmptySlot(world, product.size);
      if (!emptySlot) {
        return {
          output: `Error: no empty ${product.size}-item slots available in the machine. Remove or sell existing products first.`,
        };
      }
      if (quantity > UNITS_PER_SLOT) {
        return {
          output: `Error: each slot holds max ${UNITS_PER_SLOT} units. Tried to stock ${quantity}.`,
        };
      }
      const slot = world.machineSlots[emptySlot.row]![emptySlot.col]!;
      slot.productId = product.id;
      slot.quantity = quantity;
      // Set price from machinePrices map or default to reference price
      slot.price = world.machinePrices.get(product.id) ?? product.referencePrice;
    }

    // Remove from storage
    storageEntry.quantity -= quantity;
    if (storageEntry.quantity === 0) {
      world.storageInventory.delete(product.id);
    }

    return {
      output: `Stocked ${quantity} units of ${product.name} in the vending machine.`,
    };
  },
};
