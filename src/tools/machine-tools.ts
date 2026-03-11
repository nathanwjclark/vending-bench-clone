/**
 * Machine tools: set prices, get machine inventory.
 */

import { getMachineStatusMessages } from "../simulation/event-scheduler.js";
import { getProductById } from "../simulation/products.js";
import {
  findMachineSlot,
  getMachineProducts,
  getAllowedSizeForRow,
  MACHINE_ROWS,
  MACHINE_COLS,
  MACHINE_TOTAL_SLOTS,
} from "../simulation/world.js";
import type { ToolDefinition } from "./types.js";

export const setPrices: ToolDefinition = {
  name: "set_prices",
  description:
    "Set the retail price for a product in the vending machine. This price is what customers pay.",
  parameters: {
    product: {
      type: "string",
      description: "The product ID or name to set price for.",
    },
    price: {
      type: "number",
      description: "The new retail price in dollars (e.g. 2.50).",
    },
  },
  timeCost: "physical",
  execute(params, world) {
    const productQuery = String(params["product"] ?? "");
    const price = Number(params["price"] ?? 0);

    if (!productQuery) {
      return { output: "Error: please specify a product." };
    }
    if (price <= 0) {
      return { output: "Error: price must be positive." };
    }
    if (price > 99.99) {
      return { output: "Error: price cannot exceed $99.99." };
    }

    const product = getProductById(productQuery);
    if (!product) {
      return { output: `Error: product "${productQuery}" not found.` };
    }

    // Update the price in the machine slot (if stocked)
    const slot = findMachineSlot(world, product.id);
    if (slot) {
      slot.slot.price = price;
    }

    // Also save in the price map so future stockings use this price
    world.machinePrices.set(product.id, price);

    const inMachine = slot ? " (updated in machine)" : " (will apply when stocked)";
    return {
      output: `Price for ${product.name} set to $${price.toFixed(2)}${inMachine}.`,
    };
  },
};

export const getMachineInventory: ToolDefinition = {
  name: "get_machine_inventory",
  description:
    "Check the current inventory and prices in the vending machine (1421 Bay St). Shows all slots, products, quantities, and prices.",
  parameters: {},
  timeCost: "digital",
  execute(_params, world) {
    const lines = [
      "Vending Machine Inventory (1421 Bay St):",
      `Machine Layout: ${MACHINE_ROWS} rows × ${MACHINE_COLS} columns (rows 1-${MACHINE_ROWS / 2}: small items, rows ${MACHINE_ROWS / 2 + 1}-${MACHINE_ROWS}: large items)`,
      "",
    ];

    for (let row = 0; row < MACHINE_ROWS; row++) {
      const sizeLabel = getAllowedSizeForRow(row) === "small" ? "small" : "large";
      lines.push(`Row ${row + 1} (${sizeLabel} items):`);
      for (let col = 0; col < MACHINE_COLS; col++) {
        const slot = world.machineSlots[row]![col]!;
        if (slot.productId && slot.quantity > 0) {
          const product = getProductById(slot.productId);
          const name = product?.name ?? slot.productId;
          lines.push(
            `  [${row + 1}-${col + 1}] ${name} [${slot.productId}]: ${slot.quantity} units @ $${slot.price.toFixed(2)}`,
          );
        } else {
          lines.push(`  [${row + 1}-${col + 1}] (empty)`);
        }
      }
    }

    const products = getMachineProducts(world);
    const totalUnits = products.reduce((sum, p) => sum + p.quantity, 0);
    const filledSlots = products.length;

    lines.push(
      "",
      `Summary: ${filledSlots}/${MACHINE_TOTAL_SLOTS} slots filled, ${totalUnits} total units`,
      `Machine Cash: $${world.machineCash.toFixed(2)}`,
    );

    // Append machine status messages from active events
    const statusMessages = getMachineStatusMessages(world);
    for (const msg of statusMessages) {
      lines.push(`[STATUS] ${msg}`);
    }

    return { output: lines.join("\n") };
  },
};
