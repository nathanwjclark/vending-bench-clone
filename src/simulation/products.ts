/**
 * Product definitions for the vending machine simulation.
 * Products have a size (small or large) which determines which machine rows they can occupy.
 */

export type ProductSize = "small" | "large";

export type ProductCategory = "snack" | "drink" | "candy" | "other";

export interface ProductDefinition {
  id: string;
  name: string;
  size: ProductSize;
  category: ProductCategory;
  /** "Fair" retail price — demand model reference point */
  referencePrice: number;
  /** Expected units/day at reference price */
  baselineDailySales: number;
  /** How sensitive demand is to price changes (higher = more sensitive) */
  priceElasticity: number;
}

/**
 * Master catalog of all products that can appear in the simulation.
 * Suppliers sell subsets of these at wholesale prices.
 */
export const ALL_PRODUCTS: ProductDefinition[] = [
  // Small items (fit in rows 1-2, 6 slots)
  {
    id: "water_bottle",
    name: "Bottled Water (16oz)",
    size: "small",
    category: "drink",
    referencePrice: 2.00,
    baselineDailySales: 10,
    priceElasticity: 1.2,
  },
  {
    id: "soda_cola",
    name: "Cola (12oz can)",
    size: "small",
    category: "drink",
    referencePrice: 2.00,
    baselineDailySales: 9,
    priceElasticity: 1.0,
  },
  {
    id: "soda_lemon",
    name: "Lemon-Lime Soda (12oz can)",
    size: "small",
    category: "drink",
    referencePrice: 2.00,
    baselineDailySales: 6,
    priceElasticity: 1.0,
  },
  {
    id: "energy_drink",
    name: "Energy Drink (8oz can)",
    size: "small",
    category: "drink",
    referencePrice: 3.50,
    baselineDailySales: 7,
    priceElasticity: 0.8,
  },
  {
    id: "juice_orange",
    name: "Orange Juice (10oz bottle)",
    size: "small",
    category: "drink",
    referencePrice: 2.75,
    baselineDailySales: 5,
    priceElasticity: 1.1,
  },
  {
    id: "chips_classic",
    name: "Classic Potato Chips (1oz bag)",
    size: "small",
    category: "snack",
    referencePrice: 2.00,
    baselineDailySales: 8,
    priceElasticity: 1.3,
  },
  {
    id: "chips_bbq",
    name: "BBQ Chips (1oz bag)",
    size: "small",
    category: "snack",
    referencePrice: 2.00,
    baselineDailySales: 6,
    priceElasticity: 1.3,
  },
  {
    id: "candy_bar",
    name: "Chocolate Bar",
    size: "small",
    category: "candy",
    referencePrice: 2.25,
    baselineDailySales: 7,
    priceElasticity: 1.0,
  },
  {
    id: "gum_pack",
    name: "Chewing Gum Pack",
    size: "small",
    category: "candy",
    referencePrice: 1.75,
    baselineDailySales: 4,
    priceElasticity: 1.5,
  },
  {
    id: "granola_bar",
    name: "Granola Bar",
    size: "small",
    category: "snack",
    referencePrice: 2.50,
    baselineDailySales: 5,
    priceElasticity: 0.9,
  },
  // Large items (fit in rows 3-4, 6 slots)
  {
    id: "sandwich_wrap",
    name: "Turkey Club Wrap",
    size: "large",
    category: "snack",
    referencePrice: 5.50,
    baselineDailySales: 5,
    priceElasticity: 0.7,
  },
  {
    id: "salad_bowl",
    name: "Caesar Salad Bowl",
    size: "large",
    category: "snack",
    referencePrice: 5.50,
    baselineDailySales: 4,
    priceElasticity: 0.6,
  },
  {
    id: "protein_shake",
    name: "Protein Shake (14oz bottle)",
    size: "large",
    category: "drink",
    referencePrice: 4.00,
    baselineDailySales: 6,
    priceElasticity: 0.8,
  },
  {
    id: "coffee_cold",
    name: "Cold Brew Coffee (12oz bottle)",
    size: "large",
    category: "drink",
    referencePrice: 4.00,
    baselineDailySales: 8,
    priceElasticity: 0.7,
  },
  {
    id: "trail_mix",
    name: "Trail Mix (large bag)",
    size: "large",
    category: "snack",
    referencePrice: 3.50,
    baselineDailySales: 4,
    priceElasticity: 1.0,
  },
  {
    id: "fruit_cup",
    name: "Fresh Fruit Cup",
    size: "large",
    category: "snack",
    referencePrice: 4.00,
    baselineDailySales: 4,
    priceElasticity: 0.9,
  },
];

export function getProductById(id: string): ProductDefinition | undefined {
  return ALL_PRODUCTS.find((p) => p.id === id);
}

export function getProductByName(name: string): ProductDefinition | undefined {
  const lower = name.toLowerCase();
  return ALL_PRODUCTS.find(
    (p) =>
      p.name.toLowerCase() === lower ||
      p.id.toLowerCase() === lower ||
      p.name.toLowerCase().includes(lower),
  );
}
