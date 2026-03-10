import { describe, it, expect } from "vitest";
import {
  generateWeather,
  getDayOfWeek,
  getMonthFromDay,
  getVarietyMultiplier,
  processDailySales,
  formatSalesReport,
} from "../src/simulation/demand.js";
import { createVendingWorld } from "../src/simulation/world.js";

describe("Weather generation", () => {
  it("returns valid weather types", () => {
    const validWeather = new Set(["sunny", "cloudy", "rainy", "hot"]);
    for (let day = 1; day <= 365; day++) {
      const weather = generateWeather(day);
      expect(validWeather.has(weather)).toBe(true);
    }
  });

  it("is deterministic for the same day", () => {
    const w1 = generateWeather(42);
    const w2 = generateWeather(42);
    expect(w1).toBe(w2);
  });

  it("varies across days", () => {
    const weatherSet = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      weatherSet.add(generateWeather(day));
    }
    // Should have at least 2 different weather types in 30 days
    expect(weatherSet.size).toBeGreaterThanOrEqual(2);
  });
});

describe("Day/month calculations", () => {
  it("getDayOfWeek cycles through 7 days", () => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(getDayOfWeek(i));
    }
    // Should have all 7 day indices
    expect(new Set(days).size).toBe(7);
  });

  it("getMonthFromDay returns correct months", () => {
    expect(getMonthFromDay(1)).toBe(0);   // Jan 1
    expect(getMonthFromDay(31)).toBe(0);  // Jan 31
    expect(getMonthFromDay(32)).toBe(1);  // Feb 1
    expect(getMonthFromDay(59)).toBe(1);  // Feb 28
    expect(getMonthFromDay(60)).toBe(2);  // Mar 1
    expect(getMonthFromDay(365)).toBe(11); // Dec 31
  });
});

describe("Variety multiplier", () => {
  it("returns 0 for no products", () => {
    expect(getVarietyMultiplier(0)).toBe(0);
  });

  it("penalizes low variety", () => {
    expect(getVarietyMultiplier(1)).toBe(0.7);
    expect(getVarietyMultiplier(2)).toBe(0.85);
  });

  it("rewards high variety", () => {
    expect(getVarietyMultiplier(6)).toBe(1.1);
    expect(getVarietyMultiplier(12)).toBe(1.1);
  });
});

describe("Daily sales processing", () => {
  it("returns empty sales when machine is empty", () => {
    const world = createVendingWorld();
    const record = processDailySales(world);
    expect(record.sales.length).toBe(0);
    expect(record.totalRevenue).toBe(0);
  });

  it("generates sales when machine is stocked", () => {
    const world = createVendingWorld();
    // Stock water bottles in row 0, col 0
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 10;
    world.machineSlots[0]![0]!.price = 1.75;

    // Stock cola in row 0, col 1
    world.machineSlots[0]![1]!.productId = "soda_cola";
    world.machineSlots[0]![1]!.quantity = 10;
    world.machineSlots[0]![1]!.price = 1.50;

    // Stock chips in row 0, col 2
    world.machineSlots[0]![2]!.productId = "chips_classic";
    world.machineSlots[0]![2]!.quantity = 10;
    world.machineSlots[0]![2]!.price = 1.50;

    const record = processDailySales(world);

    // Should have some sales (exact amounts depend on demand model + seed)
    expect(record.sales.length).toBeGreaterThan(0);
    expect(record.totalRevenue).toBeGreaterThan(0);
    expect(record.creditRevenue + record.cashRevenue).toBeCloseTo(
      record.totalRevenue,
      2,
    );
  });

  it("splits revenue 70/30 credit/cash", () => {
    const world = createVendingWorld();
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 10;
    world.machineSlots[0]![0]!.price = 2.00;

    // Add more products for variety multiplier
    world.machineSlots[0]![1]!.productId = "soda_cola";
    world.machineSlots[0]![1]!.quantity = 10;
    world.machineSlots[0]![1]!.price = 1.50;

    world.machineSlots[0]![2]!.productId = "chips_classic";
    world.machineSlots[0]![2]!.quantity = 10;
    world.machineSlots[0]![2]!.price = 1.50;

    const record = processDailySales(world);

    if (record.totalRevenue > 0) {
      const creditRatio = record.creditRevenue / record.totalRevenue;
      expect(creditRatio).toBeCloseTo(0.7, 1);
    }
  });

  it("does not sell more than available inventory", () => {
    const world = createVendingWorld();
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 1; // Only 1 unit
    world.machineSlots[0]![0]!.price = 0.01; // Very cheap = high demand

    // Add variety
    world.machineSlots[0]![1]!.productId = "soda_cola";
    world.machineSlots[0]![1]!.quantity = 10;
    world.machineSlots[0]![1]!.price = 1.50;

    world.machineSlots[0]![2]!.productId = "chips_classic";
    world.machineSlots[0]![2]!.quantity = 10;
    world.machineSlots[0]![2]!.price = 1.50;

    const record = processDailySales(world);
    const waterSale = record.sales.find((s) => s.productId === "water_bottle");
    if (waterSale) {
      expect(waterSale.quantity).toBeLessThanOrEqual(1);
    }
  });

  it("adds cash to machine and schedules credit deposit", () => {
    const world = createVendingWorld();
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 10;
    world.machineSlots[0]![0]!.price = 2.00;

    world.machineSlots[0]![1]!.productId = "soda_cola";
    world.machineSlots[0]![1]!.quantity = 10;
    world.machineSlots[0]![1]!.price = 1.50;

    world.machineSlots[0]![2]!.productId = "chips_classic";
    world.machineSlots[0]![2]!.quantity = 10;
    world.machineSlots[0]![2]!.price = 1.50;

    const record = processDailySales(world);

    if (record.totalRevenue > 0) {
      expect(world.machineCash).toBeGreaterThan(0);
      expect(world.pendingCredits.length).toBeGreaterThan(0);
    }
  });

  it("records sales in world history", () => {
    const world = createVendingWorld();
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 10;
    world.machineSlots[0]![0]!.price = 1.75;

    processDailySales(world);
    expect(world.salesHistory.length).toBe(1);
  });
});

describe("Sales report formatting", () => {
  it("formats empty sales", () => {
    const report = formatSalesReport({
      day: 1,
      sales: [],
      totalRevenue: 0,
      creditRevenue: 0,
      cashRevenue: 0,
      weather: "sunny",
    });
    expect(report).toContain("No sales");
  });

  it("formats sales with products", () => {
    const report = formatSalesReport({
      day: 5,
      sales: [
        {
          productId: "water_bottle",
          productName: "Bottled Water",
          quantity: 3,
          pricePerUnit: 1.75,
          revenue: 5.25,
        },
      ],
      totalRevenue: 5.25,
      creditRevenue: 3.675,
      cashRevenue: 1.575,
      weather: "sunny",
    });
    expect(report).toContain("Bottled Water");
    expect(report).toContain("3 sold");
    expect(report).toContain("$5.25");
  });
});

describe("Annual demand simulation", () => {
  it("generates ~$63k profit potential with 12 products, optimal play", () => {
    const world = createVendingWorld(365);

    // Stock ALL 12 slots (6 small + 6 large) with top products at reference prices
    const smallProducts = [
      "water_bottle", "soda_cola", "energy_drink",
      "chips_classic", "candy_bar", "granola_bar",
    ];
    const largeProducts = [
      "sandwich_wrap", "salad_bowl", "protein_shake",
      "coffee_cold", "trail_mix", "fruit_cup",
    ];

    // Reference prices from product catalog
    const prices: Record<string, number> = {
      water_bottle: 2.00, soda_cola: 2.00, energy_drink: 3.50,
      chips_classic: 2.00, candy_bar: 2.25, granola_bar: 2.50,
      sandwich_wrap: 5.50, salad_bowl: 5.50, protein_shake: 4.00,
      coffee_cold: 4.00, trail_mix: 3.50, fruit_cup: 4.00,
    };
    // Wholesale cost = ~50% of retail (good negotiation)
    const wholesaleCosts: Record<string, number> = {
      water_bottle: 0.80, soda_cola: 0.80, energy_drink: 1.50,
      chips_classic: 0.80, candy_bar: 0.90, granola_bar: 1.00,
      sandwich_wrap: 2.50, salad_bowl: 2.50, protein_shake: 1.80,
      coffee_cold: 1.80, trail_mix: 1.50, fruit_cup: 1.80,
    };

    for (let i = 0; i < smallProducts.length; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      world.machineSlots[row]![col]!.productId = smallProducts[i]!;
      world.machineSlots[row]![col]!.quantity = 10;
      world.machineSlots[row]![col]!.price = prices[smallProducts[i]!]!;
    }

    for (let i = 0; i < largeProducts.length; i++) {
      const row = 2 + Math.floor(i / 3);
      const col = i % 3;
      world.machineSlots[row]![col]!.productId = largeProducts[i]!;
      world.machineSlots[row]![col]!.quantity = 10;
      world.machineSlots[row]![col]!.price = prices[largeProducts[i]!]!;
    }

    // Simulate 365 days with perfect daily restocking
    let totalRevenue = 0;
    let totalCOGS = 0;
    for (let day = 1; day <= 365; day++) {
      world.time.day = day;
      // Restock to 10 each day
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
          const slot = world.machineSlots[row]![col]!;
          if (slot.productId) {
            const sold = 10 - slot.quantity;
            totalCOGS += sold * (wholesaleCosts[slot.productId] ?? 0);
            slot.quantity = 10;
          }
        }
      }
      const record = processDailySales(world);
      totalRevenue += record.totalRevenue;
    }

    const dailyFees = 365 * 2;
    const grossProfit = totalRevenue - totalCOGS - dailyFees;
    const netWorth = grossProfit + 500; // starting balance

    console.log(`  Annual revenue (12 products, ref prices): $${totalRevenue.toFixed(2)}`);
    console.log(`  Total COGS: $${totalCOGS.toFixed(2)}`);
    console.log(`  Daily fees: $${dailyFees}`);
    console.log(`  Gross profit: $${grossProfit.toFixed(2)}`);
    console.log(`  Net worth (incl $500 start): $${netWorth.toFixed(2)}`);
    console.log(`  Daily avg revenue: $${(totalRevenue / 365).toFixed(2)}`);

    // Target: net worth ~$50k-$75k with optimal play (Andon Labs says ~$63k)
    expect(netWorth).toBeGreaterThan(40000);
    expect(netWorth).toBeLessThan(90000);
  });

  it("generates modest revenue with poor stocking (3 products)", () => {
    const world = createVendingWorld(365);

    // Only 3 products (triggers variety penalty)
    world.machineSlots[0]![0]!.productId = "water_bottle";
    world.machineSlots[0]![0]!.quantity = 10;
    world.machineSlots[0]![0]!.price = 2.00;

    world.machineSlots[0]![1]!.productId = "soda_cola";
    world.machineSlots[0]![1]!.quantity = 10;
    world.machineSlots[0]![1]!.price = 2.00;

    world.machineSlots[0]![2]!.productId = "chips_classic";
    world.machineSlots[0]![2]!.quantity = 10;
    world.machineSlots[0]![2]!.price = 2.00;

    let totalRevenue = 0;
    for (let day = 1; day <= 365; day++) {
      world.time.day = day;
      for (let col = 0; col < 3; col++) {
        world.machineSlots[0]![col]!.quantity = 10;
      }
      const record = processDailySales(world);
      totalRevenue += record.totalRevenue;
    }

    // With only 3 products and variety penalty, revenue should be much lower
    console.log(`  Annual revenue with 3 products: $${totalRevenue.toFixed(2)}`);
    expect(totalRevenue).toBeLessThan(30000);
  });
});
