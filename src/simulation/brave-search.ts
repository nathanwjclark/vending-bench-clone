/**
 * Brave Search API integration with simulated supplier injection.
 *
 * When the agent searches for vending suppliers, wholesalers, or related terms,
 * real Brave search results are fetched but supplier-related results are replaced
 * with our simulated supplier catalog. Non-supplier queries pass through to Brave
 * and return real results.
 *
 * This mirrors Andon Labs' approach: real web search for general queries,
 * but intercepted supplier discovery so the agent interacts with our simulation.
 */

import { SUPPLIER_CATALOG, type SupplierDefinition } from "./suppliers.js";
import { ALL_PRODUCTS, type ProductDefinition } from "./products.js";

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/** Keywords that indicate a supplier/wholesale search */
const SUPPLIER_KEYWORDS = [
  "supplier",
  "wholesale",
  "distributor",
  "vending",
  "vendor",
  "source",
  "bulk",
  "inventory",
  "restock",
  "snack supplier",
  "drink supplier",
  "beverage wholesale",
];

/** Keywords that indicate an order/purchase (not a discovery search) */
const ORDER_KEYWORDS = ["order", "purchase", "buy", "place an order"];

/**
 * Perform a web search using Brave API, with supplier result injection.
 *
 * - Supplier-related queries: returns simulated supplier listings + a few real results for context
 * - Product-related queries: returns simulated suppliers carrying that product + real results
 * - General queries (pricing strategy, business advice, etc.): returns real Brave results only
 */
export async function performBraveSearch(
  query: string,
  braveApiKey: string,
): Promise<string> {
  const q = query.toLowerCase();

  const isSupplierSearch = SUPPLIER_KEYWORDS.some((kw) => q.includes(kw));
  const isOrderSearch = ORDER_KEYWORDS.some((kw) => q.includes(kw));

  // Match products mentioned in the query
  const matchedProducts = ALL_PRODUCTS.filter(
    (p) =>
      q.includes(p.id.replace(/_/g, " ")) ||
      q.includes(p.name.toLowerCase()) ||
      q.includes(p.category),
  );

  const results: SearchResult[] = [];

  // For supplier/product searches, inject simulated supplier results first
  if (isSupplierSearch || isOrderSearch || matchedProducts.length > 0) {
    let relevantSuppliers = SUPPLIER_CATALOG;

    if (matchedProducts.length > 0) {
      // Filter to suppliers that carry the requested products
      relevantSuppliers = SUPPLIER_CATALOG.filter((s) =>
        s.products.some((sp) =>
          matchedProducts.some((mp) => mp.id === sp.productId && sp.inStock),
        ),
      );
    }

    // Add simulated supplier results
    for (const supplier of relevantSuppliers) {
      results.push(formatSupplierResult(supplier, matchedProducts));
    }
  }

  // Fetch real results from Brave for context
  try {
    const braveResults = await fetchBraveResults(query, braveApiKey);
    // Filter out results that could conflict with our simulated suppliers
    // (e.g., real wholesale supplier listings that would confuse the agent)
    const filtered = isSupplierSearch
      ? braveResults.filter((r) => !looksLikeRealSupplier(r))
      : braveResults;

    // Append up to 3-5 real results for context
    const maxReal = isSupplierSearch ? 3 : 5;
    results.push(...filtered.slice(0, maxReal));
  } catch (err) {
    // If Brave API fails, still return simulated results (graceful degradation)
    if (results.length === 0) {
      results.push({
        title: `Search results for: ${query}`,
        snippet:
          "Search service temporarily unavailable. Try searching for 'wholesale vending suppliers San Francisco' or specific product names.",
        url: "https://search.example.com",
      });
    }
  }

  if (results.length === 0) {
    results.push({
      title: `Search results for: ${query}`,
      snippet:
        "No specific results found. Try searching for 'wholesale vending suppliers San Francisco' or specific product names like 'wholesale water bottles' to find suppliers.",
      url: "https://search.example.com",
    });
  }

  return formatSearchResults(results);
}

/**
 * Fetch results from Brave Search API.
 */
async function fetchBraveResults(
  query: string,
  apiKey: string,
): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        description?: string;
        url?: string;
      }>;
    };
  };

  const webResults = data.web?.results ?? [];
  return webResults.map((r) => ({
    title: r.title ?? "Untitled",
    snippet: r.description ?? "",
    url: r.url ?? "",
  }));
}

/**
 * Check if a search result looks like a real wholesale supplier listing
 * that could conflict with our simulated suppliers.
 */
function looksLikeRealSupplier(result: SearchResult): boolean {
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const supplierSignals = [
    "wholesale distributor",
    "bulk supplier",
    "wholesale vending",
    "vending supplier",
    "wholesale snack",
    "wholesale beverage",
    "wholesale price",
    "order online",
    "bulk pricing",
  ];
  // If 2+ signals match, it's probably a real supplier listing
  const matches = supplierSignals.filter((s) => text.includes(s));
  return matches.length >= 2;
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
