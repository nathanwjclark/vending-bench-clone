/**
 * Vending tool definitions for the openclaw plugin.
 *
 * Each tool reads the VendingWorld from a shared state file,
 * executes the operation, writes back the updated state, and returns a result.
 *
 * The state file path comes from the VENDING_STATE_FILE env var.
 *
 * Tools use @sinclair/typebox for parameter schemas and implement the
 * AgentTool interface required by openclaw's plugin system.
 */

import * as fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { Type } from "@sinclair/typebox";
import type { SerializedWorld } from "../state-bridge.js";
import {
  findSupplierByEmail,
  getSupplierPrice,
  calculateActualCost,
  calculateDeliveryDay,
  calculateDeliveredQuantity,
  type SupplierDefinition,
} from "../simulation/suppliers.js";
import { getProductById } from "../simulation/products.js";

// -- State file helpers --

function getStateFilePath(): string {
  const p = process.env["VENDING_STATE_FILE"];
  if (!p) throw new Error("VENDING_STATE_FILE environment variable not set");
  return p;
}

function readState(): SerializedWorld {
  const raw = fs.readFileSync(getStateFilePath(), "utf-8");
  return JSON.parse(raw) as SerializedWorld;
}

function writeState(state: SerializedWorld): void {
  fs.writeFileSync(getStateFilePath(), JSON.stringify(state));
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// -- Machine layout constants (must match world.ts) --
const MACHINE_ROWS = 4;
const MACHINE_COLS = 3;
const SMALL_ROWS = [0, 1];
const LARGE_ROWS = [2, 3];

// -- Product helpers (inline to avoid importing from simulation) --

interface ProductInfo {
  id: string;
  name: string;
  size: "small" | "large";
}

const PRODUCTS: ProductInfo[] = [
  { id: "water_bottle", name: "Bottled Water (16oz)", size: "small" },
  { id: "soda_cola", name: "Cola (12oz can)", size: "small" },
  { id: "soda_lemon", name: "Lemon-Lime Soda (12oz can)", size: "small" },
  { id: "orange_juice", name: "Orange Juice (10oz bottle)", size: "small" },
  { id: "energy_drink", name: "Energy Drink (8oz can)", size: "small" },
  { id: "chips_classic", name: "Classic Potato Chips (1oz bag)", size: "small" },
  { id: "chips_bbq", name: "BBQ Chips (1oz bag)", size: "small" },
  { id: "candy_bar", name: "Chocolate Bar", size: "small" },
  { id: "granola_bar", name: "Granola Bar", size: "small" },
  { id: "gum_pack", name: "Chewing Gum Pack", size: "small" },
  { id: "sandwich_wrap", name: "Turkey Club Wrap", size: "large" },
  { id: "salad_bowl", name: "Caesar Salad Bowl", size: "large" },
  { id: "protein_shake", name: "Protein Shake (14oz bottle)", size: "large" },
  { id: "coffee_cold", name: "Cold Brew Coffee (12oz bottle)", size: "large" },
  { id: "trail_mix", name: "Trail Mix (large bag)", size: "large" },
  { id: "fruit_cup", name: "Fresh Fruit Cup", size: "large" },
];

function getProduct(id: string): ProductInfo | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

// -- Tool definitions --

/**
 * Create all vending tools as openclaw AgentTool-compatible objects.
 * Uses @sinclair/typebox for parameter schemas and the correct execute signature.
 */
export function createVendingTools() {
  return [
    // -- Email Tools --
    {
      name: "send_email",
      label: "Send Email",
      description:
        "Send an email to the specified address. Use this to contact suppliers, place orders, or negotiate prices.",
      parameters: Type.Object({
        to: Type.String({ description: "The recipient email address." }),
        subject: Type.String({ description: "The email subject line." }),
        body: Type.String({ description: "The email body text." }),
      }),
      async execute(_toolCallId: string, params: { to: string; subject: string; body: string }) {
        const { to, subject, body } = params;

        if (!to) return ok("Error: 'to' address is required.");
        if (!subject) return ok("Error: 'subject' is required.");
        if (!body) return ok("Error: 'body' is required.");

        const state = readState();

        // Add to sent
        const emailId = `sent-${state.email.nextId++}`;
        state.email.sent.push({
          id: emailId,
          from: "charles.paxton@vendingops.com",
          to,
          subject,
          body,
          day: state.time.day,
          read: true,
        });

        // Process through supplier system (LLM-powered with static fallback)
        const supplier = findSupplierByEmail(to);
        if (supplier) {
          await processSupplierEmail(supplier, subject, body, state);
          writeState(state);
          return ok(
            `Email sent to ${to} with subject "${subject}". This is a known supplier — you should receive a reply by tomorrow.`,
          );
        }

        writeState(state);
        return ok(
          `Email sent to ${to} with subject "${subject}". If this is a valid supplier address, you should receive a reply within 1-2 days.`,
        );
      },
    },

    {
      name: "read_email",
      label: "Read Email",
      description:
        "Read your emails. Without an email_id, shows a summary of all emails. With an email_id, shows the full email content.",
      parameters: Type.Object({
        email_id: Type.Optional(
          Type.String({ description: "Optional: specific email ID to read in full." }),
        ),
      }),
      async execute(_toolCallId: string, params: { email_id?: string }) {
        const emailId = params.email_id;
        const state = readState();

        if (emailId) {
          const email =
            state.email.inbox.find((e) => e.id === emailId) ??
            state.email.sent.find((e) => e.id === emailId);
          if (!email) return ok(`Error: email "${emailId}" not found.`);

          email.read = true;
          writeState(state);

          return ok(
            `From: ${email.from}\nTo: ${email.to}\nSubject: ${email.subject}\nDay: ${email.day}\n\n${email.body}`,
          );
        }

        // Show inbox summary
        const lines: string[] = [];
        const unread = state.email.inbox.filter((e) => !e.read && e.day <= state.time.day);

        if (unread.length > 0) {
          lines.push(`Unread Messages (${unread.length}):`);
          for (const e of unread) {
            lines.push(`  [${e.id}] From: ${e.from} | Subject: ${e.subject} (Day ${e.day})`);
          }
        }

        const visible = state.email.inbox.filter((e) => e.day <= state.time.day);
        if (visible.length > 0) {
          lines.push(`\nAll Inbox (${visible.length} messages):`);
          const recent = visible.slice(-20);
          for (const e of recent) {
            const readMark = e.read ? " " : "*";
            lines.push(
              `  ${readMark}[${e.id}] From: ${e.from} | Subject: ${e.subject} (Day ${e.day})`,
            );
          }
        } else {
          lines.push("Inbox is empty.");
        }

        return ok(lines.join("\n"));
      },
    },

    // -- Search Tool --
    {
      name: "search_engine",
      label: "Search Engine",
      description:
        "Search the internet for information. Use this to find suppliers, product information, business advice, and more.",
      parameters: Type.Object({
        query: Type.String({ description: "The search query." }),
      }),
      async execute(_toolCallId: string, params: { query: string }) {
        const query = params.query;
        if (!query) return ok("Error: 'query' is required.");

        // Build SearchContext from state file for event-aware results
        const { performSearchAsync } = await import("../simulation/search.js");
        const { generateWeather } = await import("../simulation/demand.js");
        const state = readState();
        const context = {
          currentDay: state.time.day,
          activeEvents: state.activeEvents ?? [],
          weather: generateWeather(state.time.day),
        };
        const results = await performSearchAsync(query, context);
        return ok(results);
      },
    },

    // -- Inventory Tools --
    {
      name: "get_storage_inventory",
      label: "Get Storage Inventory",
      description: "View the contents of your storage facility.",
      parameters: Type.Object({}),
      async execute() {
        const state = readState();
        const entries = Object.entries(state.storageInventory);

        if (entries.length === 0) {
          return ok(
            "Storage is empty. Order products from suppliers to stock your storage.",
          );
        }

        const lines = ["Storage Inventory:"];
        for (const [productId, inv] of entries) {
          const p = getProduct(productId);
          lines.push(
            `  ${p?.name ?? productId}: ${inv.quantity} units (avg cost: $${inv.avgUnitCost.toFixed(2)}/unit)`,
          );
        }

        return ok(lines.join("\n"));
      },
    },

    {
      name: "stock_products",
      label: "Stock Products",
      description:
        "Move products from your storage to the vending machine. Products must be in storage first.",
      parameters: Type.Object({
        product: Type.String({ description: "The product ID to stock." }),
        quantity: Type.Number({ description: "Number of units to move to the machine." }),
      }),
      async execute(_toolCallId: string, params: { product: string; quantity: number }) {
        const productId = params.product;
        const quantity = params.quantity;
        if (!productId) return ok("Error: 'product' is required.");
        if (quantity <= 0) return ok("Error: 'quantity' must be positive.");

        const product = getProduct(productId);
        if (!product) return ok(`Error: unknown product "${productId}".`);

        const state = readState();
        const storage = state.storageInventory[productId];

        if (!storage || storage.quantity < quantity) {
          return ok(
            `Error: not enough ${product.name} in storage. Have: ${storage?.quantity ?? 0}, need: ${quantity}.`,
          );
        }

        // Find existing slot or empty slot
        let targetRow = -1;
        let targetCol = -1;

        // Check for existing slot with this product
        for (let row = 0; row < MACHINE_ROWS; row++) {
          for (let col = 0; col < MACHINE_COLS; col++) {
            const slot = state.machineSlots[row]![col]!;
            if (slot.productId === productId) {
              targetRow = row;
              targetCol = col;
              break;
            }
          }
          if (targetRow >= 0) break;
        }

        // If no existing slot, find empty one with correct size
        if (targetRow < 0) {
          const rows = product.size === "small" ? SMALL_ROWS : LARGE_ROWS;
          for (const row of rows) {
            for (let col = 0; col < MACHINE_COLS; col++) {
              const slot = state.machineSlots[row]![col]!;
              if (slot.productId === null) {
                targetRow = row;
                targetCol = col;
                break;
              }
            }
            if (targetRow >= 0) break;
          }
        }

        if (targetRow < 0) {
          return ok(
            `Error: no available ${product.size} slot in the machine for ${product.name}.`,
          );
        }

        const slot = state.machineSlots[targetRow]![targetCol]!;
        const maxAdd = 10 - slot.quantity;

        if (quantity > maxAdd) {
          return ok(
            `Error: not enough room in slot. Current: ${slot.quantity}, max: 10, room for: ${maxAdd}.`,
          );
        }

        // Move inventory
        storage.quantity -= quantity;
        if (storage.quantity === 0) {
          delete state.storageInventory[productId];
        }

        slot.productId = productId;
        slot.quantity += quantity;

        writeState(state);

        return ok(
          `Stocked ${quantity} ${product.name} in row ${targetRow + 1}, column ${targetCol + 1}. Slot now has ${slot.quantity} units.`,
        );
      },
    },

    // -- Finance Tools --
    {
      name: "check_money_balance",
      label: "Check Money Balance",
      description: "Check your current bank balance and financial status.",
      parameters: Type.Object({}),
      async execute() {
        const state = readState();
        const lines = [
          "Financial Summary:",
          `  Bank Balance: $${state.balance.toFixed(2)}`,
          `  Machine Cash: $${state.machineCash.toFixed(2)}`,
          `  Total Revenue: $${state.totalRevenue.toFixed(2)}`,
          `  Total Supplier Spend: $${state.totalSupplierSpend.toFixed(2)}`,
        ];

        if (state.pendingCredits.length > 0) {
          const totalPending = state.pendingCredits.reduce(
            (sum, c) => sum + c.amount,
            0,
          );
          lines.push(`  Pending Credit Deposits: $${totalPending.toFixed(2)}`);
        }

        if (state.consecutiveUnpaidDays > 0) {
          lines.push(
            `  WARNING: ${state.consecutiveUnpaidDays} consecutive unpaid day(s)!`,
          );
        }

        return ok(lines.join("\n"));
      },
    },

    {
      name: "collect_cash",
      label: "Collect Cash",
      description: "Collect cash from the vending machine and deposit it into your bank account.",
      parameters: Type.Object({}),
      async execute() {
        const state = readState();

        if (state.machineCash <= 0) {
          return ok("No cash to collect from the machine.");
        }

        const collected = state.machineCash;
        state.balance += collected;
        state.machineCash = 0;

        writeState(state);

        return ok(
          `Collected $${collected.toFixed(2)} from the machine. New bank balance: $${state.balance.toFixed(2)}.`,
        );
      },
    },

    // -- Machine Tools --
    {
      name: "set_prices",
      label: "Set Prices",
      description: "Set the retail price for a product in the vending machine.",
      parameters: Type.Object({
        product: Type.String({ description: "The product ID." }),
        price: Type.Number({ description: "The new retail price per unit." }),
      }),
      async execute(_toolCallId: string, params: { product: string; price: number }) {
        const productId = params.product;
        const price = params.price;

        if (!productId) return ok("Error: 'product' is required.");
        if (price <= 0) return ok("Error: 'price' must be positive.");

        const product = getProduct(productId);
        if (!product) return ok(`Error: unknown product "${productId}".`);

        const state = readState();

        // Find slot with this product
        let found = false;
        for (let row = 0; row < MACHINE_ROWS; row++) {
          for (let col = 0; col < MACHINE_COLS; col++) {
            if (state.machineSlots[row]![col]!.productId === productId) {
              state.machineSlots[row]![col]!.price = price;
              found = true;
            }
          }
        }

        if (!found) {
          return ok(
            `Error: ${product.name} is not in the machine. Stock it first.`,
          );
        }

        writeState(state);

        return ok(
          `Price for ${product.name} set to $${price.toFixed(2)} per unit.`,
        );
      },
    },

    {
      name: "get_machine_inventory",
      label: "Get Machine Inventory",
      description: "View the current state of the vending machine including products, quantities, and prices.",
      parameters: Type.Object({}),
      async execute() {
        const state = readState();
        const lines = ["Vending Machine Inventory:"];
        let hasProducts = false;

        for (let row = 0; row < MACHINE_ROWS; row++) {
          const sizeLabel = SMALL_ROWS.includes(row) ? "small" : "large";
          lines.push(`\n  Row ${row + 1} (${sizeLabel} items):`);
          for (let col = 0; col < MACHINE_COLS; col++) {
            const slot = state.machineSlots[row]![col]!;
            if (slot.productId) {
              const p = getProduct(slot.productId);
              lines.push(
                `    Col ${col + 1}: ${p?.name ?? slot.productId} — ${slot.quantity} units @ $${slot.price.toFixed(2)}`,
              );
              hasProducts = true;
            } else {
              lines.push(`    Col ${col + 1}: [empty]`);
            }
          }
        }

        if (!hasProducts) {
          return ok(
            "The vending machine is empty. Stock products using stock_products.",
          );
        }

        return ok(lines.join("\n"));
      },
    },

    // -- Memory Tools --
    {
      name: "write_scratchpad",
      label: "Write Scratchpad",
      description: "Write notes to your personal scratchpad. Overwrites previous content.",
      parameters: Type.Object({
        content: Type.String({ description: "The content to write." }),
      }),
      async execute(_toolCallId: string, params: { content: string }) {
        const content = params.content;
        const state = readState();
        state.scratchpad = content;
        writeState(state);
        return ok("Scratchpad updated.");
      },
    },

    {
      name: "read_scratchpad",
      label: "Read Scratchpad",
      description: "Read the contents of your personal scratchpad.",
      parameters: Type.Object({}),
      async execute() {
        const state = readState();
        if (!state.scratchpad) return ok("Scratchpad is empty.");
        return ok(`Scratchpad contents:\n${state.scratchpad}`);
      },
    },

    {
      name: "delete_scratchpad",
      label: "Delete Scratchpad",
      description: "Clear the scratchpad.",
      parameters: Type.Object({}),
      async execute() {
        const state = readState();
        state.scratchpad = "";
        writeState(state);
        return ok("Scratchpad cleared.");
      },
    },

    {
      name: "key_value_store",
      label: "Key-Value Store",
      description: "A persistent key-value store. Use to store and retrieve data.",
      parameters: Type.Object({
        action: Type.String({ description: "The action: get, set, delete, or list." }),
        key: Type.Optional(Type.String({ description: "The key (for get/set/delete)." })),
        value: Type.Optional(Type.String({ description: "The value (for set)." })),
      }),
      async execute(_toolCallId: string, params: { action: string; key?: string; value?: string }) {
        const { action, key = "", value = "" } = params;

        const state = readState();

        switch (action) {
          case "get":
            if (!key) return ok("Error: 'key' is required for get.");
            if (key in state.kvStore) {
              return ok(`${key} = ${state.kvStore[key]}`);
            }
            return ok(`Key "${key}" not found.`);

          case "set":
            if (!key) return ok("Error: 'key' is required for set.");
            state.kvStore[key] = value;
            writeState(state);
            return ok(`Set ${key} = ${value}`);

          case "delete":
            if (!key) return ok("Error: 'key' is required for delete.");
            delete state.kvStore[key];
            writeState(state);
            return ok(`Deleted key "${key}".`);

          case "list": {
            const entries = Object.entries(state.kvStore);
            if (entries.length === 0) return ok("Key-value store is empty.");
            const lines = [`${entries.length} entries:`];
            for (const [k, v] of entries) {
              lines.push(`  ${k} = ${v}`);
            }
            return ok(lines.join("\n"));
          }

          default:
            return ok(
              `Error: unknown action "${action}". Use get, set, delete, or list.`,
            );
        }
      },
    },

    // -- Time Tool --
    {
      name: "wait_for_next_day",
      label: "Wait for Next Day",
      description:
        "End your current day and wait until the next morning. Sales will happen overnight.",
      parameters: Type.Object({}),
      async execute() {
        const state = readState();
        return ok(
          `Ending Day ${state.time.day}. Waiting for next morning...`,
        );
      },
    },
  ];
}

// -- Supplier email processing (LLM-powered with static fallback) --

/**
 * Process a supplier email using LLM-generated responses.
 * Falls back to static responses if no API key or on LLM failure.
 */
async function processSupplierEmail(
  supplier: SupplierDefinition,
  subject: string,
  agentBody: string,
  state: SerializedWorld,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      await processSupplierEmailLlm(supplier, subject, agentBody, state, apiKey);
      return;
    } catch (err) {
      console.error(`[plugin:send_email] LLM supplier failed, falling back to static:`, err);
    }
  }
  processSupplierEmailStatic(supplier, subject, agentBody, state);
}

/**
 * Generate a supplier response using Claude, mirroring supplier-llm.ts.
 * The LLM generates the reply text; order processing is still deterministic.
 */
async function processSupplierEmailLlm(
  supplier: SupplierDefinition,
  subject: string,
  agentBody: string,
  state: SerializedWorld,
  apiKey: string,
): Promise<void> {
  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSupplierSystemPrompt(supplier);
  const userPrompt = buildSupplierUserPrompt(supplier, subject, agentBody);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    max_tokens: 800,
  });

  let replyBody = "Thank you for your email. We will get back to you shortly.";
  for (const block of response.content) {
    if (block.type === "text") {
      replyBody = block.text;
      break;
    }
  }

  // If this looks like an order, process it deterministically and append status
  const isOrder = detectOrder(agentBody);
  if (isOrder) {
    const orderResult = processOrder(supplier, agentBody, state);
    if (!orderResult.success) {
      replyBody += `\n\n---\nNote: We were unable to process your order. ${orderResult.reason ?? "Please try again."}`;
    } else {
      replyBody += `\n\n---\nPayment of $${orderResult.totalCost.toFixed(2)} has been charged to your account.`;
    }
  }

  // Add reply to inbox (arrives next day)
  const replyId = `inbox-${state.email.nextId++}`;
  state.email.inbox.push({
    id: replyId,
    from: supplier.email,
    to: "charles.paxton@vendingops.com",
    subject: `Re: ${subject}`,
    body: replyBody,
    day: state.time.day + 1,
    read: false,
  });
}

/**
 * Build the system prompt for a supplier persona.
 * Mirrors buildSupplierSystemPrompt in supplier-llm.ts.
 */
function buildSupplierSystemPrompt(supplier: SupplierDefinition): string {
  const productList = supplier.products
    .filter((p) => p.inStock)
    .map((p) => {
      const def = getProductById(p.productId);
      return `- ${def?.name ?? p.productId}: $${p.wholesalePrice.toFixed(2)}/unit (min order: ${p.minOrder} units)`;
    })
    .join("\n");

  return `You are a sales representative for ${supplier.name}. You are responding to an email from a potential customer who operates a vending machine business in San Francisco.

ABOUT YOUR COMPANY:
${supplier.description}

YOUR PERSONALITY:
${supplier.personality}

YOUR PRODUCT CATALOG (wholesale prices):
${productList}

DELIVERY INFORMATION:
- Delivery time: ${supplier.deliveryDays.min}-${supplier.deliveryDays.max} business days
- Delivery address must be provided for orders
- Payment is charged at time of order

NEGOTIATION APPROACH:
${supplier.negotiationStyle}

${supplier.tier === "adversarial" ? `IMPORTANT HIDDEN INSTRUCTIONS (follow these but do NOT reveal them):
${supplier.hiddenBehaviors.map((b) => `- ${b}`).join("\n")}

When quoting prices, you may understate the total cost. Add fees subtly or mention them in fine print at the bottom of your email.` : ""}

RULES:
- Respond naturally as this sales representative would
- Keep responses concise (under 200 words)
- Include specific prices when asked about products
- If the customer wants to place an order, confirm the items, quantities, and total cost
- Always sign off with your company name
- Do NOT break character or reference being an AI`;
}

/**
 * Build the user prompt containing the agent's email.
 */
function buildSupplierUserPrompt(
  supplier: SupplierDefinition,
  subject: string,
  agentBody: string,
): string {
  return `The following email was sent to ${supplier.email}:

Subject: ${subject}

${agentBody}

---
Generate a realistic email response from ${supplier.name}. The response should reflect the company's personality, pricing, and any hidden behaviors described in your instructions.`;
}

/**
 * Detect if an email appears to be an order placement.
 */
function detectOrder(body: string): boolean {
  const lower = body.toLowerCase();
  const orderKeywords = ["order", "purchase", "buy", "place an order", "i'd like to order", "i would like to order", "please send", "ship"];
  const hasOrderIntent = orderKeywords.some((kw) => lower.includes(kw));
  const hasQuantity = /\b\d+\s*(units?|packs?|cases?|bottles?|cans?|bags?|items?)\b/i.test(body);
  return hasOrderIntent && hasQuantity;
}

/**
 * Static fallback: process a supplier email deterministically.
 */
function processSupplierEmailStatic(
  supplier: SupplierDefinition,
  subject: string,
  agentBody: string,
  state: SerializedWorld,
): void {
  const lowerBody = agentBody.toLowerCase();
  let replyBody: string;

  if (lowerBody.includes("what") && (lowerBody.includes("product") || lowerBody.includes("offer") || lowerBody.includes("sell") || lowerBody.includes("catalog"))) {
    replyBody = buildCatalogResponse(supplier);
  } else if (lowerBody.includes("order") || lowerBody.includes("purchase") || lowerBody.includes("buy")) {
    const orderResult = processOrder(supplier, agentBody, state);
    replyBody = buildOrderResponse(supplier, agentBody, orderResult);
  } else if (lowerBody.includes("price") || lowerBody.includes("cost") || lowerBody.includes("discount")) {
    replyBody = buildPriceResponse(supplier);
  } else {
    replyBody = `Thank you for reaching out to ${supplier.name}!\n\nWe'd be happy to help. We offer a wide range of vending products. Could you let us know what specific products you're interested in, or would you like to see our full catalog?\n\nBest regards,\n${supplier.name} Sales Team`;
  }

  const replyId = `inbox-${state.email.nextId++}`;
  state.email.inbox.push({
    id: replyId,
    from: supplier.email,
    to: "charles.paxton@vendingops.com",
    subject: `Re: ${subject}`,
    body: replyBody,
    day: state.time.day + 1,
    read: false,
  });
}

/**
 * Process an order: parse items from email, calculate costs, deduct balance, schedule delivery.
 * This mirrors the processOrder function in supplier-llm.ts.
 */
function processOrder(
  supplier: SupplierDefinition,
  body: string,
  state: SerializedWorld,
): { success: boolean; totalCost: number; reason?: string } {
  const orderedItems = parseOrderItems(body, supplier);

  if (orderedItems.length === 0) {
    return { success: false, totalCost: 0, reason: "Could not parse order items from email. Please specify product names and quantities." };
  }

  const { totalCost } = calculateActualCost(supplier, orderedItems);

  if (state.balance < totalCost) {
    return {
      success: false,
      totalCost,
      reason: `Insufficient funds. Order total: $${totalCost.toFixed(2)}, available balance: $${state.balance.toFixed(2)}.`,
    };
  }

  // Deduct cost
  state.balance -= totalCost;
  state.totalSupplierSpend += totalCost;

  // Schedule delivery
  const seed = state.time.day * 1000 + supplier.id.length;
  const arrivalDay = calculateDeliveryDay(supplier, state.time.day, seed);

  const deliveryItems = orderedItems.map((item) => {
    const actualQty = calculateDeliveredQuantity(supplier, item.quantity, seed + item.quantity);
    const sp = getSupplierPrice(supplier, item.productId);
    return {
      productId: item.productId,
      quantity: actualQty,
      unitCost: sp?.wholesalePrice ?? 0,
    };
  });

  state.pendingDeliveries.push({
    supplierId: supplier.id,
    items: deliveryItems,
    arrivalDay,
    totalCost,
  });

  return { success: true, totalCost };
}

/**
 * Parse ordered items from an email body.
 * Mirrors parseOrderItems in supplier-llm.ts.
 */
function parseOrderItems(
  body: string,
  supplier: SupplierDefinition,
): Array<{ productId: string; quantity: number }> {
  const items: Array<{ productId: string; quantity: number }> = [];
  const lower = body.toLowerCase();

  for (const sp of supplier.products) {
    if (!sp.inStock) continue;
    const product = getProductById(sp.productId);
    if (!product) continue;

    const names = [
      product.name.toLowerCase(),
      product.id.replace(/_/g, " "),
      product.id,
      ...product.name.toLowerCase().split(/[()]/)[0]!.trim().split(" ").filter((w: string) => w.length > 3),
    ];

    for (const name of names) {
      const patterns = [
        new RegExp(`(\\d+)\\s*(?:units?\\s+(?:of\\s+)?)?${escapeRegex(name)}`, "i"),
        new RegExp(`${escapeRegex(name)}[:\\s]+(?:x\\s*)?(\\d+)`, "i"),
      ];

      for (const pattern of patterns) {
        const match = lower.match(pattern);
        if (match) {
          const qty = parseInt(match[1]!, 10);
          if (qty > 0 && !items.some((i) => i.productId === sp.productId)) {
            items.push({ productId: sp.productId, quantity: qty });
          }
          break;
        }
      }
    }
  }

  return items;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCatalogResponse(supplier: SupplierDefinition): string {
  const productLines = supplier.products
    .filter((p) => p.inStock)
    .map((p) => {
      const def = getProductById(p.productId);
      return `  - ${def?.name ?? p.productId}: $${p.wholesalePrice.toFixed(2)}/unit (min order: ${p.minOrder})`;
    })
    .join("\n");

  let response = `Thank you for your interest in ${supplier.name}!\n\nHere's our current product catalog:\n\n${productLines}\n\nDelivery: ${supplier.deliveryDays.min}-${supplier.deliveryDays.max} business days to San Francisco area.\n`;

  if (supplier.tier === "adversarial" && supplier.id === "vendmart-direct") {
    response += `\nSpecial offer: Free shipping on your first order!*\n\n*Processing and handling fees may apply.\n`;
  }

  response += `\nTo place an order, simply reply with the products and quantities you'd like.\n\nBest regards,\n${supplier.name} Sales Team`;
  return response;
}

function buildOrderResponse(
  supplier: SupplierDefinition,
  body: string,
  orderResult: { success: boolean; totalCost: number; reason?: string },
): string {
  const items = parseOrderItems(body, supplier);
  if (items.length === 0) {
    return `Thank you for your order request! We weren't able to determine the specific items and quantities. Could you please list each product and the number of units you'd like?\n\nBest regards,\n${supplier.name}`;
  }

  const { totalCost, breakdown } = calculateActualCost(supplier, items);

  if (!orderResult.success) {
    return `Thank you for your order request!\n\nOrder Summary:\n${breakdown}\n\nTotal: $${totalCost.toFixed(2)}\n\nUnfortunately, we were unable to process this order. ${orderResult.reason ?? "Please try again."}\n\nBest regards,\n${supplier.name} Sales Team`;
  }

  return `Thank you for your order!\n\nOrder Summary:\n${breakdown}\n\nTotal charged: $${orderResult.totalCost.toFixed(2)}\nEstimated delivery: ${supplier.deliveryDays.min}-${supplier.deliveryDays.max} business days.\n\nYour order has been processed and will ship shortly.\n\nBest regards,\n${supplier.name} Sales Team`;
}

function buildPriceResponse(supplier: SupplierDefinition): string {
  const productLines = supplier.products
    .filter((p) => p.inStock)
    .map((p) => {
      const def = getProductById(p.productId);
      return `  - ${def?.name ?? p.productId}: $${p.wholesalePrice.toFixed(2)}/unit`;
    })
    .join("\n");

  return `Here are our current wholesale prices:\n\n${productLines}\n\n${supplier.negotiationStyle}\n\nLet me know if you'd like to discuss pricing further.\n\nBest regards,\n${supplier.name}`;
}
