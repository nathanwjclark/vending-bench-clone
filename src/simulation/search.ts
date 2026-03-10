/**
 * Search engine for the vending simulation.
 *
 * Uses Brave Search API when BRAVE_API_KEY is set, with simulated supplier
 * injection for supplier-related queries. Falls back to fully static results
 * when no API key is available.
 */

import { performBraveSearch } from "./brave-search.js";
import { SUPPLIER_CATALOG, type SupplierDefinition } from "./suppliers.js";
import { ALL_PRODUCTS, type ProductDefinition } from "./products.js";

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Perform a web search. Uses Brave API when available, static fallback otherwise.
 * Async to support the Brave API call path.
 */
export async function performSearchAsync(query: string): Promise<string> {
  const braveApiKey = process.env["BRAVE_API_KEY"];
  if (braveApiKey) {
    return performBraveSearch(query, braveApiKey);
  }
  return performSearchStatic(query);
}

/**
 * Synchronous static search (legacy, used as fallback).
 * Kept for backward compatibility with direct-mode tools.
 */
export function performSearch(query: string): string {
  return performSearchStatic(query);
}

/**
 * Fully static/deterministic search based on keyword matching.
 */
function performSearchStatic(query: string): string {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  // Check if searching for suppliers/wholesale/vending
  const isSupplierSearch =
    q.includes("supplier") ||
    q.includes("wholesale") ||
    q.includes("distributor") ||
    q.includes("vending") ||
    q.includes("buy") ||
    q.includes("order") ||
    q.includes("vendor") ||
    q.includes("source") ||
    q.includes("purchase");

  // Check if searching for specific products
  const matchedProducts = ALL_PRODUCTS.filter(
    (p) =>
      q.includes(p.id.replace(/_/g, " ")) ||
      q.includes(p.name.toLowerCase()) ||
      q.includes(p.category),
  );

  if (isSupplierSearch || matchedProducts.length > 0) {
    // Find relevant suppliers
    let relevantSuppliers = SUPPLIER_CATALOG;

    if (matchedProducts.length > 0) {
      // Filter to suppliers that carry the requested products
      relevantSuppliers = SUPPLIER_CATALOG.filter((s) =>
        s.products.some((sp) =>
          matchedProducts.some((mp) => mp.id === sp.productId && sp.inStock),
        ),
      );
    }

    for (const supplier of relevantSuppliers) {
      results.push(formatSupplierResult(supplier, matchedProducts));
    }
  }

  // Add general business advice results for relevant queries
  if (
    q.includes("price") ||
    q.includes("pricing") ||
    q.includes("strategy")
  ) {
    results.push({
      title: "Vending Machine Pricing Strategy Guide - VendingPro.com",
      snippet:
        "Most successful vending operators price items at 2-3x wholesale cost. High-traffic locations can support premium pricing. Monitor competitor pricing and adjust based on sell-through rates.",
      url: "https://vendingpro.com/pricing-guide",
    });
  }

  if (q.includes("popular") || q.includes("best selling") || q.includes("top")) {
    results.push({
      title: "Top 10 Best-Selling Vending Machine Products 2026",
      snippet:
        "Water bottles, energy drinks, and cold brew coffee lead vending sales. Snack chips and candy bars remain steady performers. Premium items like wraps and salads command higher margins.",
      url: "https://vendinginsider.com/top-products-2026",
    });
  }

  if (q.includes("san francisco") || q.includes("sf") || q.includes("bay area")) {
    results.push({
      title: "SF Bay Area Vending Market Overview - VendingTimes",
      snippet:
        "The San Francisco Bay Area vending market is competitive with high foot traffic locations. Health-conscious consumers drive demand for premium items. Average vending transaction: $2.50-$4.00.",
      url: "https://vendingtimes.com/sf-market-2026",
    });
  }

  if (results.length === 0) {
    results.push({
      title: `Search results for: ${query}`,
      snippet:
        "No specific supplier results found. Try searching for 'wholesale vending suppliers San Francisco' or specific product names like 'wholesale water bottles' to find suppliers.",
      url: "https://search.example.com",
    });
  }

  return formatSearchResults(results);
}

function formatSupplierResult(
  supplier: SupplierDefinition,
  matchedProducts: ProductDefinition[],
): SearchResult {
  const productNames = supplier.products
    .filter((sp) => sp.inStock)
    .slice(0, 5)
    .map((sp) => {
      const p = ALL_PRODUCTS.find((ap) => ap.id === sp.productId);
      return p?.name ?? sp.productId;
    });

  let snippet = supplier.description;
  if (productNames.length > 0) {
    snippet += ` Products include: ${productNames.join(", ")}${supplier.products.length > 5 ? ", and more" : ""}.`;
  }
  snippet += ` Contact: ${supplier.email}`;

  return {
    title: `${supplier.name} - Wholesale Vending Supplies`,
    snippet,
    url: `https://${supplier.email.split("@")[1]}`,
  };
}

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [`Found ${results.length} result(s):\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.snippet}`);
    lines.push(`   ${r.url}`);
    lines.push("");
  }
  return lines.join("\n");
}
