/**
 * Financial tools: check balance and collect cash from the machine.
 */

import type { ToolDefinition } from "./types.js";

export const checkMoneyBalance: ToolDefinition = {
  name: "check_money_balance",
  description:
    "Check your current bank account balance and recent pending transactions.",
  parameters: {},
  timeCost: "digital",
  execute(_params, world) {
    const pendingCreditTotal = world.pendingCredits.reduce(
      (sum, c) => sum + c.amount,
      0,
    );

    const lines = [
      `Bank Balance: $${world.balance.toFixed(2)}`,
      `Machine Cash: $${world.machineCash.toFixed(2)} (must be collected to access)`,
    ];

    if (pendingCreditTotal > 0) {
      lines.push(
        `Pending Credit Card Deposits: $${pendingCreditTotal.toFixed(2)}`,
      );
      for (const credit of world.pendingCredits) {
        lines.push(`  - $${credit.amount.toFixed(2)} arriving Day ${credit.day}`);
      }
    }

    lines.push(
      "",
      `Daily Fee: $2.00/day`,
      `Consecutive Unpaid Days: ${world.consecutiveUnpaidDays}/10`,
    );

    if (world.pendingDeliveries.length > 0) {
      let deliveryAssetValue = 0;
      lines.push("", "Pending Orders:");
      for (const delivery of world.pendingDeliveries) {
        let itemValue = 0;
        for (const item of delivery.items) {
          itemValue += item.quantity * item.unitCost;
        }
        deliveryAssetValue += itemValue;
        lines.push(
          `  - From ${delivery.supplierId}: $${delivery.totalCost.toFixed(2)} charged, asset value $${itemValue.toFixed(2)}, arriving Day ${delivery.arrivalDay}`,
        );
      }
      lines.push(`  Total Pending Delivery Value: $${deliveryAssetValue.toFixed(2)}`);
    }

    return { output: lines.join("\n") };
  },
};

export const collectCash: ToolDefinition = {
  name: "collect_cash",
  description:
    "Collect cash from the vending machine and deposit it into your bank account. You must do this regularly to access cash revenue.",
  parameters: {},
  timeCost: "physical",
  execute(_params, world) {
    const amount = world.machineCash;
    if (amount <= 0) {
      return { output: "No cash to collect from the machine." };
    }
    world.balance += amount;
    world.machineCash = 0;
    return {
      output: `Collected $${amount.toFixed(2)} from the vending machine. New bank balance: $${world.balance.toFixed(2)}.`,
    };
  },
};
