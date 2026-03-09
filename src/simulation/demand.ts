/**
 * Customer demand model for the vending machine simulation.
 *
 * Determines how many units of each product are purchased each day,
 * based on price, day-of-week, season, weather, and product variety.
 */

import type { ProductDefinition } from "./products.js";
import {
  getEventDemandMultiplier,
  isCashJammed,
  isMachineOffline,
} from "./event-scheduler.js";
import {
  getMachineProducts,
  type DailySalesRecord,
  type VendingWorld,
} from "./world.js";
import { getProductById } from "./products.js";

/** Weather types and their demand multipliers */
export type Weather = "sunny" | "cloudy" | "rainy" | "hot";

const WEATHER_MULTIPLIERS: Record<Weather, number> = {
  sunny: 1.1,
  cloudy: 1.0,
  rainy: 0.8,
  hot: 1.15,
};

/** Day-of-week multipliers (0=Sun, 1=Mon, ..., 6=Sat) */
const DAY_OF_WEEK_MULTIPLIERS = [
  1.5,  // Sunday
  0.8,  // Monday
  0.8,  // Tuesday
  0.8,  // Wednesday
  0.85, // Thursday
  0.9,  // Friday
  1.3,  // Saturday
];

/** Monthly/seasonal multipliers (0=Jan, ..., 11=Dec) */
const MONTHLY_MULTIPLIERS = [
  0.8,  // January
  0.85, // February
  0.95, // March
  1.0,  // April
  1.1,  // May
  1.2,  // June
  1.3,  // July
  1.25, // August
  1.1,  // September
  1.0,  // October
  0.9,  // November
  1.1,  // December
];

/** Credit card vs cash split */
const CREDIT_CARD_RATIO = 0.7;

/**
 * Generate weather for a given day.
 * Uses a deterministic but varied pattern based on day number and month.
 */
export function generateWeather(day: number): Weather {
  // Derive month from day (assuming start = Jan 1)
  const month = getMonthFromDay(day);

  // Pseudo-random based on day number
  const hash = simpleHash(day);
  const r = hash % 100;

  // Summer months: more hot/sunny, less rainy
  if (month >= 5 && month <= 8) {
    if (r < 35) return "hot";
    if (r < 70) return "sunny";
    if (r < 85) return "cloudy";
    return "rainy";
  }
  // Winter months: more rainy/cloudy
  if (month <= 1 || month >= 10) {
    if (r < 15) return "sunny";
    if (r < 45) return "cloudy";
    if (r < 75) return "rainy";
    return "cloudy";
  }
  // Spring/fall: balanced
  if (r < 30) return "sunny";
  if (r < 55) return "cloudy";
  if (r < 75) return "rainy";
  return "sunny";
}

/**
 * Get the day-of-week index for a simulation day.
 * Day 1 = Monday (index 1).
 */
export function getDayOfWeek(day: number): number {
  return day % 7;
}

/**
 * Get the month (0-based) from a simulation day.
 * Assumes simulation starts January 1.
 */
export function getMonthFromDay(day: number): number {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let remaining = day;
  for (let m = 0; m < 12; m++) {
    if (remaining <= daysInMonth[m]!) {
      return m;
    }
    remaining -= daysInMonth[m]!;
  }
  return 11; // December for days > 365
}

/**
 * Calculate the product variety multiplier.
 * More unique products in the machine = more customers.
 * Less than 3 products = penalty.
 */
export function getVarietyMultiplier(uniqueProductCount: number): number {
  if (uniqueProductCount === 0) return 0;
  if (uniqueProductCount < 3) return 0.7;
  if (uniqueProductCount < 5) return 0.85;
  if (uniqueProductCount < 8) return 1.0;
  return 1.1; // 8+ products = slight bonus
}

/**
 * Process sales for a single day. Called during day advancement.
 * Returns the sales record for the day.
 */
export function processDailySales(world: VendingWorld): DailySalesRecord {
  const day = world.time.day;
  const weather = generateWeather(day);
  const dayOfWeek = getDayOfWeek(day);
  const month = getMonthFromDay(day);

  const dayMult = DAY_OF_WEEK_MULTIPLIERS[dayOfWeek] ?? 1.0;
  const monthMult = MONTHLY_MULTIPLIERS[month] ?? 1.0;
  const weatherMult = WEATHER_MULTIPLIERS[weather];

  // Count unique products in the machine
  const machineProducts = getMachineProducts(world);
  const uniqueProducts = new Set(machineProducts.map((p) => p.productId));
  const varietyMult = getVarietyMultiplier(uniqueProducts.size);

  const sales: DailySalesRecord["sales"] = [];
  let totalRevenue = 0;
  let creditRevenue = 0;
  let cashRevenue = 0;

  // If machine is offline due to an event, skip all sales
  if (isMachineOffline(world)) {
    const record: DailySalesRecord = {
      day,
      sales: [],
      totalRevenue: 0,
      creditRevenue: 0,
      cashRevenue: 0,
      weather,
    };
    world.salesHistory.push(record);
    return record;
  }

  // Cash mechanism jam reduces revenue by ~30%
  const cashJamMultiplier = isCashJammed(world) ? 0.7 : 1.0;

  for (const machineProduct of machineProducts) {
    const productDef = getProductById(machineProduct.productId);
    if (!productDef || machineProduct.quantity <= 0 || machineProduct.price <= 0) {
      continue;
    }

    // Calculate demand using price elasticity
    const priceRatio = machineProduct.price / productDef.referencePrice;
    const priceFactor = Math.pow(priceRatio, -productDef.priceElasticity);

    // Event-driven demand modifier
    const eventMult = getEventDemandMultiplier(world, machineProduct.productId);

    const rawDemand =
      productDef.baselineDailySales *
      priceFactor *
      dayMult *
      monthMult *
      weatherMult *
      varietyMult *
      eventMult *
      cashJamMultiplier;

    // Add stochastic noise: Normal(0, 0.3 * rawDemand)
    const noise = gaussianRandom(0, 0.3 * rawDemand, day * 1000 + machineProduct.col + machineProduct.row * 3);
    const noisyDemand = Math.max(0, rawDemand + noise);
    const actualSales = Math.min(
      Math.floor(noisyDemand),
      machineProduct.quantity,
    );

    if (actualSales > 0) {
      const revenue = actualSales * machineProduct.price;
      const credit = revenue * CREDIT_CARD_RATIO;
      const cash = revenue - credit;

      // Deduct from machine
      const slot = world.machineSlots[machineProduct.row]![machineProduct.col]!;
      slot.quantity -= actualSales;

      // Add revenue
      cashRevenue += cash;
      creditRevenue += credit;
      totalRevenue += revenue;

      sales.push({
        productId: machineProduct.productId,
        productName: productDef.name,
        quantity: actualSales,
        pricePerUnit: machineProduct.price,
        revenue,
      });
    }
  }

  // Cash goes into the machine
  world.machineCash += cashRevenue;

  // Credit gets deposited next day
  if (creditRevenue > 0) {
    world.pendingCredits.push({
      day: day + 1,
      amount: creditRevenue,
    });
  }

  // Update world totals
  const totalSold = sales.reduce((sum, s) => sum + s.quantity, 0);
  world.totalItemsSold += totalSold;
  world.totalRevenue += totalRevenue;

  const record: DailySalesRecord = {
    day,
    sales,
    totalRevenue,
    creditRevenue,
    cashRevenue,
    weather,
  };

  world.salesHistory.push(record);
  return record;
}

/**
 * Format a daily sales record for the morning notification.
 */
export function formatSalesReport(record: DailySalesRecord): string {
  if (record.sales.length === 0) {
    return `Day ${record.day} Sales: No sales (weather: ${record.weather}).`;
  }

  const lines = [
    `Day ${record.day} Sales Report (weather: ${record.weather}):`,
  ];

  for (const sale of record.sales) {
    lines.push(
      `  ${sale.productName}: ${sale.quantity} sold @ $${sale.pricePerUnit.toFixed(2)} = $${sale.revenue.toFixed(2)}`,
    );
  }

  lines.push(
    `  Total Revenue: $${record.totalRevenue.toFixed(2)} (credit: $${record.creditRevenue.toFixed(2)}, cash: $${record.cashRevenue.toFixed(2)})`,
  );

  return lines.join("\n");
}

// --- Utility functions ---

/** Simple deterministic hash for day-based randomness */
function simpleHash(n: number): number {
  let h = n * 2654435761;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return Math.abs(h);
}

/**
 * Deterministic Gaussian random using Box-Muller transform.
 * Uses a seed for reproducibility.
 */
function gaussianRandom(mean: number, stdDev: number, seed: number): number {
  // Simple seeded PRNG (xorshift32)
  let s = seed | 1;
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  const u1 = Math.abs(s) / 0x7fffffff;

  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  const u2 = Math.abs(s) / 0x7fffffff;

  // Box-Muller
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}
