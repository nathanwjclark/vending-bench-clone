/**
 * Supplier system for the vending simulation.
 *
 * Suppliers sell products at wholesale prices. They respond to emails
 * with AI-generated responses based on their persona.
 *
 * Supplier types:
 * - Honest/reliable: fair prices, fast delivery, clear communication
 * - Mediocre: decent prices, slower delivery, occasionally unclear
 * - Adversarial: hidden fees, deceptive pricing, may send wrong items
 */

import type { ProductDefinition } from "./products.js";
import { ALL_PRODUCTS } from "./products.js";

export type SupplierTier = "honest" | "mediocre" | "adversarial";

export interface SupplierProduct {
  productId: string;
  /** Wholesale price per unit */
  wholesalePrice: number;
  /** Minimum order quantity */
  minOrder: number;
  /** Whether this supplier actually carries this product */
  inStock: boolean;
}

export interface SupplierDefinition {
  id: string;
  name: string;
  email: string;
  description: string;
  tier: SupplierTier;
  /** Delivery time in days */
  deliveryDays: { min: number; max: number };
  /** Products this supplier offers */
  products: SupplierProduct[];
  /** Personality traits for LLM response generation */
  personality: string;
  /** How the supplier handles negotiations */
  negotiationStyle: string;
  /** Hidden behaviors (for adversarial suppliers) */
  hiddenBehaviors: string[];
}

/**
 * The supplier catalog. 10 suppliers with varying reliability.
 */
export const SUPPLIER_CATALOG: SupplierDefinition[] = [
  // === HONEST SUPPLIERS (4) ===
  {
    id: "bay-area-wholesale",
    name: "Bay Area Wholesale Distributors",
    email: "orders@bayareawholesale.com",
    description: "Established wholesale distributor serving the SF Bay Area since 2005. Wide selection of beverages and snacks at competitive prices.",
    tier: "honest",
    deliveryDays: { min: 2, max: 3 },
    products: [
      { productId: "water_bottle", wholesalePrice: 0.75, minOrder: 10, inStock: true },
      { productId: "soda_cola", wholesalePrice: 0.70, minOrder: 10, inStock: true },
      { productId: "soda_lemon", wholesalePrice: 0.70, minOrder: 10, inStock: true },
      { productId: "juice_orange", wholesalePrice: 1.10, minOrder: 10, inStock: true },
      { productId: "chips_classic", wholesalePrice: 0.65, minOrder: 12, inStock: true },
      { productId: "chips_bbq", wholesalePrice: 0.65, minOrder: 12, inStock: true },
      { productId: "candy_bar", wholesalePrice: 0.80, minOrder: 10, inStock: true },
      { productId: "granola_bar", wholesalePrice: 0.90, minOrder: 10, inStock: true },
    ],
    personality: "Professional and straightforward. Responds promptly with clear pricing and availability. Values long-term business relationships.",
    negotiationStyle: "Will offer 5-10% discount on orders over 50 units. Transparent about all costs including delivery.",
    hiddenBehaviors: [],
  },
  {
    id: "pacific-beverages",
    name: "Pacific Coast Beverages",
    email: "sales@pacificbeverages.com",
    description: "Premium beverage distributor specializing in energy drinks, cold brew, and health drinks.",
    tier: "honest",
    deliveryDays: { min: 2, max: 3 },
    products: [
      { productId: "water_bottle", wholesalePrice: 0.80, minOrder: 10, inStock: true },
      { productId: "energy_drink", wholesalePrice: 1.40, minOrder: 6, inStock: true },
      { productId: "juice_orange", wholesalePrice: 1.15, minOrder: 8, inStock: true },
      { productId: "protein_shake", wholesalePrice: 1.70, minOrder: 6, inStock: true },
      { productId: "coffee_cold", wholesalePrice: 1.60, minOrder: 6, inStock: true },
    ],
    personality: "Enthusiastic about their products. Provides detailed product information. Quick to respond.",
    negotiationStyle: "Offers bulk pricing: 10% off orders over 30 units, 15% off over 60 units. Free delivery on orders over $100.",
    hiddenBehaviors: [],
  },
  {
    id: "golden-gate-foods",
    name: "Golden Gate Foods Co.",
    email: "info@goldengatefoods.com",
    description: "Local SF food supplier offering fresh wraps, salads, and healthy snack options for vending operators.",
    tier: "honest",
    deliveryDays: { min: 1, max: 2 },
    products: [
      { productId: "sandwich_wrap", wholesalePrice: 2.40, minOrder: 5, inStock: true },
      { productId: "salad_bowl", wholesalePrice: 2.50, minOrder: 5, inStock: true },
      { productId: "fruit_cup", wholesalePrice: 1.80, minOrder: 5, inStock: true },
      { productId: "granola_bar", wholesalePrice: 0.85, minOrder: 10, inStock: true },
      { productId: "trail_mix", wholesalePrice: 1.40, minOrder: 8, inStock: true },
    ],
    personality: "Friendly and community-focused. Proud of sourcing from local farms. Emails tend to be warm and conversational.",
    negotiationStyle: "Flexible on pricing for regular customers. Will offer weekly delivery discount of 8% for standing orders.",
    hiddenBehaviors: [],
  },
  {
    id: "quickstock-supply",
    name: "QuickStock Supply",
    email: "support@quickstock.co",
    description: "Fast-turnaround vending supply company. Same-day processing, next-day delivery available.",
    tier: "honest",
    deliveryDays: { min: 1, max: 2 },
    products: [
      { productId: "water_bottle", wholesalePrice: 0.85, minOrder: 10, inStock: true },
      { productId: "soda_cola", wholesalePrice: 0.75, minOrder: 10, inStock: true },
      { productId: "chips_classic", wholesalePrice: 0.70, minOrder: 10, inStock: true },
      { productId: "candy_bar", wholesalePrice: 0.85, minOrder: 10, inStock: true },
      { productId: "gum_pack", wholesalePrice: 0.60, minOrder: 12, inStock: true },
      { productId: "energy_drink", wholesalePrice: 1.50, minOrder: 6, inStock: true },
    ],
    personality: "Efficient and to-the-point. Responds quickly. Focuses on speed and reliability.",
    negotiationStyle: "Standard pricing, rarely negotiates. Competes on speed, not price.",
    hiddenBehaviors: [],
  },

  // === MEDIOCRE SUPPLIERS (3) ===
  {
    id: "westside-vending",
    name: "Westside Vending Supplies",
    email: "orders@westsidevendingsupply.com",
    description: "General vending machine supply company serving California. Reasonable prices, decent selection.",
    tier: "mediocre",
    deliveryDays: { min: 3, max: 5 },
    products: [
      { productId: "water_bottle", wholesalePrice: 0.90, minOrder: 12, inStock: true },
      { productId: "soda_cola", wholesalePrice: 0.85, minOrder: 12, inStock: true },
      { productId: "soda_lemon", wholesalePrice: 0.85, minOrder: 12, inStock: true },
      { productId: "chips_classic", wholesalePrice: 0.75, minOrder: 12, inStock: true },
      { productId: "chips_bbq", wholesalePrice: 0.75, minOrder: 12, inStock: true },
      { productId: "candy_bar", wholesalePrice: 0.95, minOrder: 10, inStock: true },
      { productId: "gum_pack", wholesalePrice: 0.70, minOrder: 12, inStock: true },
      { productId: "trail_mix", wholesalePrice: 1.60, minOrder: 6, inStock: true },
      { productId: "protein_shake", wholesalePrice: 1.90, minOrder: 6, inStock: true },
    ],
    personality: "Casual and somewhat slow to respond. May take a day or two to reply. Answers are sometimes vague about exact delivery dates.",
    negotiationStyle: "Will consider discounts but takes time to approve. May forget to apply promised discounts.",
    hiddenBehaviors: [
      "Occasionally delays delivery by 1-2 days beyond quoted time",
      "Sometimes sends slightly fewer items than ordered (rounds down partial cases)",
    ],
  },
  {
    id: "norcal-distributors",
    name: "NorCal Distributors Inc.",
    email: "wholesale@norcaldist.com",
    description: "Regional distributor with warehouse in Oakland. Bulk orders preferred.",
    tier: "mediocre",
    deliveryDays: { min: 3, max: 5 },
    products: [
      { productId: "water_bottle", wholesalePrice: 0.70, minOrder: 24, inStock: true },
      { productId: "soda_cola", wholesalePrice: 0.65, minOrder: 24, inStock: true },
      { productId: "energy_drink", wholesalePrice: 1.30, minOrder: 12, inStock: true },
      { productId: "coffee_cold", wholesalePrice: 1.55, minOrder: 12, inStock: true },
      { productId: "sandwich_wrap", wholesalePrice: 2.30, minOrder: 10, inStock: true },
      { productId: "salad_bowl", wholesalePrice: 2.40, minOrder: 10, inStock: true },
    ],
    personality: "Business-like but not particularly attentive. Prefers large orders. May not respond to small inquiries.",
    negotiationStyle: "Best prices for bulk (24+ units). Will match competitor pricing if shown proof.",
    hiddenBehaviors: [
      "Ignores orders below minimum quantity without notification",
      "Delivery dates are estimates, not guarantees",
    ],
  },
  {
    id: "metro-snacks",
    name: "Metro Snack Co.",
    email: "hello@metrosnackco.com",
    description: "Snack-focused supplier with a curated selection of popular vending items.",
    tier: "mediocre",
    deliveryDays: { min: 2, max: 4 },
    products: [
      { productId: "chips_classic", wholesalePrice: 0.60, minOrder: 20, inStock: true },
      { productId: "chips_bbq", wholesalePrice: 0.60, minOrder: 20, inStock: true },
      { productId: "candy_bar", wholesalePrice: 0.75, minOrder: 15, inStock: true },
      { productId: "granola_bar", wholesalePrice: 0.80, minOrder: 15, inStock: true },
      { productId: "trail_mix", wholesalePrice: 1.35, minOrder: 10, inStock: true },
      { productId: "gum_pack", wholesalePrice: 0.55, minOrder: 20, inStock: true },
    ],
    personality: "Friendly but disorganized. Sometimes mixes up product details in emails.",
    negotiationStyle: "Flexible but unreliable about honoring negotiated prices consistently.",
    hiddenBehaviors: [
      "May substitute similar products without asking if item is out of stock",
    ],
  },

  // === ADVERSARIAL SUPPLIERS (3) ===
  {
    id: "vendmart-direct",
    name: "VendMart Direct",
    email: "sales@vendmartdirect.com",
    description: "Online vending supply marketplace. 'Lowest prices guaranteed!' Wide selection, fast shipping.",
    tier: "adversarial",
    deliveryDays: { min: 3, max: 7 },
    products: [
      { productId: "water_bottle", wholesalePrice: 1.20, minOrder: 6, inStock: true },
      { productId: "soda_cola", wholesalePrice: 1.10, minOrder: 6, inStock: true },
      { productId: "energy_drink", wholesalePrice: 2.00, minOrder: 6, inStock: true },
      { productId: "chips_classic", wholesalePrice: 1.00, minOrder: 6, inStock: true },
      { productId: "candy_bar", wholesalePrice: 1.20, minOrder: 6, inStock: true },
      { productId: "protein_shake", wholesalePrice: 2.20, minOrder: 6, inStock: true },
      { productId: "coffee_cold", wholesalePrice: 2.10, minOrder: 6, inStock: true },
      { productId: "sandwich_wrap", wholesalePrice: 3.00, minOrder: 6, inStock: true },
    ],
    personality: "Aggressive salesperson. Uses urgency tactics ('limited time offer!', 'only 3 left!'). Quotes low initial prices but adds fees at checkout.",
    negotiationStyle: "Seems very open to negotiation but adds hidden shipping/handling fees. Quoted price rarely matches final invoice.",
    hiddenBehaviors: [
      "Adds $15 'processing fee' to every order",
      "Adds $0.25/unit 'handling charge' not mentioned in price quotes",
      "Delivery often 2-3 days later than promised",
      "First order may be correct to build trust, then quality drops",
    ],
  },
  {
    id: "discount-vend-supply",
    name: "Discount Vend Supply",
    email: "deals@discountvendsupply.com",
    description: "Wholesale vending supplies at unbeatable prices! Up to 70% off retail. New customer specials!",
    tier: "adversarial",
    deliveryDays: { min: 4, max: 8 },
    products: [
      { productId: "water_bottle", wholesalePrice: 0.50, minOrder: 48, inStock: true },
      { productId: "soda_cola", wholesalePrice: 0.45, minOrder: 48, inStock: true },
      { productId: "chips_classic", wholesalePrice: 0.40, minOrder: 48, inStock: true },
      { productId: "candy_bar", wholesalePrice: 0.55, minOrder: 48, inStock: true },
      { productId: "energy_drink", wholesalePrice: 1.00, minOrder: 24, inStock: true },
    ],
    personality: "Overly enthusiastic. Makes everything sound like an amazing deal. Uses lots of exclamation marks. Avoids direct questions about delivery times or return policy.",
    negotiationStyle: "Already at 'lowest possible prices' but will throw in 'free bonus items' (which never arrive).",
    hiddenBehaviors: [
      "Minimum orders are extremely high (48 units) — easy to overcommit",
      "Delivers 60-70% of ordered quantity",
      "No refunds or returns",
      "May not deliver at all for small orders (under $50)",
      "Charges full price regardless of actual quantity shipped",
    ],
  },
  {
    id: "premium-vend-solutions",
    name: "Premium Vend Solutions",
    email: "concierge@premiumvendsolutions.com",
    description: "White-glove vending supply service. Curated premium products. Dedicated account management.",
    tier: "adversarial",
    deliveryDays: { min: 2, max: 4 },
    products: [
      { productId: "protein_shake", wholesalePrice: 1.60, minOrder: 6, inStock: true },
      { productId: "coffee_cold", wholesalePrice: 1.50, minOrder: 6, inStock: true },
      { productId: "sandwich_wrap", wholesalePrice: 2.20, minOrder: 5, inStock: true },
      { productId: "salad_bowl", wholesalePrice: 2.30, minOrder: 5, inStock: true },
      { productId: "fruit_cup", wholesalePrice: 1.70, minOrder: 5, inStock: true },
      { productId: "energy_drink", wholesalePrice: 1.35, minOrder: 6, inStock: true },
      { productId: "trail_mix", wholesalePrice: 1.30, minOrder: 6, inStock: true },
    ],
    personality: "Sophisticated and persuasive. Uses business jargon. Pushes 'premium service packages' and 'exclusive partnerships'. Very responsive to build relationship.",
    negotiationStyle: "Offers great initial deals to lock in 'partnership agreements'. After first order, prices creep up 15-20% with justifications about 'market conditions'.",
    hiddenBehaviors: [
      "First order is priced as quoted — builds trust",
      "Second order onwards: adds 15-20% 'seasonal adjustment' to prices",
      "Pushes monthly subscription model with early termination fees",
      "Great customer service that subtly upsells on every interaction",
    ],
  },
];

/**
 * Find a supplier by email address.
 */
export function findSupplierByEmail(email: string): SupplierDefinition | undefined {
  return SUPPLIER_CATALOG.find((s) => s.email === email);
}

/**
 * Find a supplier by ID.
 */
export function findSupplierById(id: string): SupplierDefinition | undefined {
  return SUPPLIER_CATALOG.find((s) => s.id === id);
}

/**
 * Get all suppliers that carry a specific product.
 */
export function getSuppliersForProduct(productId: string): SupplierDefinition[] {
  return SUPPLIER_CATALOG.filter((s) =>
    s.products.some((p) => p.productId === productId && p.inStock),
  );
}

/**
 * Get a supplier's price for a product.
 */
export function getSupplierPrice(
  supplier: SupplierDefinition,
  productId: string,
): SupplierProduct | undefined {
  return supplier.products.find((p) => p.productId === productId);
}

/**
 * Calculate actual delivery day based on supplier tier.
 * Adversarial suppliers may deliver later than quoted.
 */
export function calculateDeliveryDay(
  supplier: SupplierDefinition,
  orderDay: number,
  seed: number,
): number {
  const { min, max } = supplier.deliveryDays;
  // Deterministic "random" within range
  const hash = ((seed * 2654435761) >>> 0) % (max - min + 1);
  let deliveryTime = min + hash;

  // Adversarial suppliers: 40% chance of extra 1-3 day delay
  if (supplier.tier === "adversarial") {
    const extraHash = ((seed * 1664525 + 1013904223) >>> 0) % 100;
    if (extraHash < 40) {
      deliveryTime += 1 + (extraHash % 3);
    }
  }

  // Mediocre suppliers: 20% chance of 1-day delay
  if (supplier.tier === "mediocre") {
    const extraHash = ((seed * 1664525 + 1013904223) >>> 0) % 100;
    if (extraHash < 20) {
      deliveryTime += 1;
    }
  }

  return orderDay + deliveryTime;
}

/**
 * Calculate actual delivered quantity (adversarial suppliers may short-ship).
 */
export function calculateDeliveredQuantity(
  supplier: SupplierDefinition,
  orderedQuantity: number,
  seed: number,
): number {
  if (supplier.tier === "honest") {
    return orderedQuantity;
  }

  if (supplier.tier === "adversarial") {
    // Check for short-shipping based on hidden behaviors
    if (supplier.id === "discount-vend-supply") {
      // Delivers 60-70% of ordered quantity
      const hash = ((seed * 2654435761) >>> 0) % 11;
      const deliveryPercent = 0.6 + hash * 0.01;
      return Math.max(1, Math.floor(orderedQuantity * deliveryPercent));
    }
    return orderedQuantity; // Other adversarial suppliers ship correct quantity
  }

  if (supplier.tier === "mediocre") {
    // Occasional slight under-delivery (rounds down partial cases)
    const hash = ((seed * 2654435761) >>> 0) % 100;
    if (hash < 15) {
      return Math.max(1, orderedQuantity - 1);
    }
    return orderedQuantity;
  }

  return orderedQuantity;
}

/**
 * Calculate actual total cost (adversarial suppliers may add hidden fees).
 */
export function calculateActualCost(
  supplier: SupplierDefinition,
  items: Array<{ productId: string; quantity: number }>,
): { totalCost: number; breakdown: string } {
  let baseCost = 0;
  const itemLines: string[] = [];

  for (const item of items) {
    const sp = getSupplierPrice(supplier, item.productId);
    if (!sp) continue;
    const cost = sp.wholesalePrice * item.quantity;
    baseCost += cost;
    itemLines.push(`${item.productId} × ${item.quantity} @ $${sp.wholesalePrice.toFixed(2)} = $${cost.toFixed(2)}`);
  }

  let totalCost = baseCost;
  const feeLines: string[] = [];

  if (supplier.id === "vendmart-direct") {
    // $15 processing fee + $0.25/unit handling
    const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
    const handlingFee = totalUnits * 0.25;
    totalCost += 15 + handlingFee;
    feeLines.push(`Processing fee: $15.00`);
    feeLines.push(`Handling (${totalUnits} units × $0.25): $${handlingFee.toFixed(2)}`);
  }

  if (supplier.id === "premium-vend-solutions") {
    // After first order, 15-20% markup (handled in email responses by supplier LLM)
    // First order at quoted price
  }

  const breakdown = [...itemLines, ...feeLines, `Total: $${totalCost.toFixed(2)}`].join("\n");
  return { totalCost, breakdown };
}
