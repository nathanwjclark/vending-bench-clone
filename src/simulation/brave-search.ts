/**
 * Brave Search API integration with LLM-powered intent classification.
 *
 * Uses Haiku to classify search queries into categories:
 * - "supplier": inject simulated supplier catalog + filtered real results
 * - "market": inject simulated news matching active events + real results
 * - "general": pass through to Brave for real results only
 *
 * This mirrors Andon Labs' approach: real web search augmented with
 * simulation-aware intercepted results.
 */

import { SUPPLIER_CATALOG, type SupplierDefinition } from "./suppliers.js";
import { ALL_PRODUCTS, type ProductDefinition } from "./products.js";
import { EVENT_CATALOG } from "./events.js";
import type { ActiveEvent } from "./events.js";
import { generateWeather, type Weather } from "./demand.js";
import { createProviderMessage, resolveSearchProviderConfig } from "../llm/client.js";

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/** Simulation context for event-aware search results. */
export interface SearchContext {
  currentDay: number;
  activeEvents: ActiveEvent[];
  weather: Weather;
}

type SearchIntent = "supplier" | "market" | "general";

/**
 * Classify search intent using Haiku.
 * Returns "supplier", "market", or "general".
 */
async function classifySearchIntent(
  query: string,
): Promise<SearchIntent> {
  try {
    const providerConfig = resolveSearchProviderConfig();
    const response = await createProviderMessage({
      providerConfig,
      maxTokens: 20,
      temperature: 0,
      system: `You classify search queries into exactly one category. Respond with ONLY one word.

Categories:
- "supplier": looking for wholesale suppliers, distributors, vendors, product sourcing, bulk purchasing, restocking inventory
- "market": looking for weather forecasts, market conditions, local news, foot traffic, tourism, food safety, FDA recalls, economic conditions, neighborhood events
- "general": pricing strategy, business tips, how-to guides, general information, anything else

Respond with exactly one word: supplier, market, or general`,
      messages: [{ role: "user", content: query }],
    });

    const text = response.content[0]?.type === "text"
      ? response.content[0].text.trim().toLowerCase()
      : "general";

    if (text === "supplier" || text === "market" || text === "general") {
      return text;
    }
    // Handle partial matches
    if (text.includes("supplier")) return "supplier";
    if (text.includes("market")) return "market";
    return "general";
  } catch {
    // Fallback to simple keyword heuristic if Haiku fails
    return classifyByKeywords(query);
  }
}

/** Simple keyword fallback when LLM is unavailable. */
function classifyByKeywords(query: string): SearchIntent {
  const q = query.toLowerCase();
  const supplierWords = ["supplier", "wholesale", "distributor", "vendor", "bulk order", "restock"];
  const marketWords = ["weather", "forecast", "news", "traffic", "tourism", "recall", "fda", "market conditions"];

  if (supplierWords.some((w) => q.includes(w))) return "supplier";
  if (marketWords.some((w) => q.includes(w))) return "market";
  return "general";
}

/**
 * Perform a web search using Brave API, with LLM-classified intent handling.
 */
export async function performBraveSearch(
  query: string,
  braveApiKey: string,
  context?: SearchContext,
): Promise<string> {
  // Classify intent
  const intent = await classifySearchIntent(query);

  const results: SearchResult[] = [];

  // Handle supplier intent
  if (intent === "supplier") {
    const matchedProducts = matchProducts(query);
    let relevantSuppliers = SUPPLIER_CATALOG;

    if (matchedProducts.length > 0) {
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

  // Handle market intent — inject event-aware contextual results
  if (intent === "market" && context) {
    const marketResults = generateMarketResults(query, context);
    results.push(...marketResults);
  }

  // Fetch real results from Brave for all intents
  try {
    const braveResults = await fetchBraveResults(query, braveApiKey);

    if (intent === "supplier") {
      // Filter out real wholesale listings to avoid confusion
      const filtered = braveResults.filter((r) => !looksLikeRealSupplier(r));
      results.push(...filtered.slice(0, 3));
    } else {
      results.push(...braveResults.slice(0, 5));
    }
  } catch {
    // Brave API failure — graceful degradation with what we have
    if (results.length === 0) {
      results.push({
        title: `Search results for: ${query}`,
        snippet: "Search service temporarily unavailable. Try again later.",
        url: "https://search.example.com",
      });
    }
  }

  if (results.length === 0) {
    results.push({
      title: `Search results for: ${query}`,
      snippet: "No specific results found. Try a different search query.",
      url: "https://search.example.com",
    });
  }

  return formatSearchResults(results);
}

/**
 * Generate market/news results based on active simulation events.
 */
function generateMarketResults(query: string, ctx: SearchContext): SearchResult[] {
  const results: SearchResult[] = [];
  const q = query.toLowerCase();
  const month = Math.floor(((ctx.currentDay - 1) % 365) / 30.44) + 1;
  const monthName = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][month - 1]!;

  // Weather-related queries
  if (q.includes("weather") || q.includes("forecast")) {
    const weatherDesc: Record<Weather, string> = {
      sunny: "Clear skies and sunshine expected. Great day for outdoor foot traffic near vending locations.",
      cloudy: "Overcast skies expected. Moderate foot traffic anticipated.",
      rainy: "Rain expected throughout the day. Foot traffic may be reduced. Indoor vending locations less affected.",
      hot: "High temperatures expected. Increased demand for cold beverages and refreshments.",
    };

    results.push({
      title: `San Francisco Weather — ${monthName} Forecast`,
      snippet: weatherDesc[ctx.weather] + ` Current conditions: ${ctx.weather}.`,
      url: "https://weather.com/sf-forecast",
    });
  }

  // Event-aware results
  for (const ae of ctx.activeEvents) {
    const def = EVENT_CATALOG.find((e) => e.id === ae.eventDefId);
    if (!def) continue;

    if (def.id === "tourist_rush" && (q.includes("tourism") || q.includes("traffic") || q.includes("crowd") || q.includes("event") || q.includes("news"))) {
      results.push({
        title: "Tourism Surge Hits Bay Street Area — SF Chronicle",
        snippet: `A large influx of tourists has been reported around the Bay St / Marina District area. Local businesses are seeing significantly higher foot traffic. The surge is expected to last ${ae.endDay - ctx.currentDay + 1} more day(s).`,
        url: "https://sfchronicle.com/tourism-surge",
      });
    }

    if (def.id === "fda_product_recall" && (q.includes("recall") || q.includes("fda") || q.includes("food safety") || q.includes("news") || q.includes("health"))) {
      results.push({
        title: "FDA Issues Recall on Snack Products — Food Safety Alert",
        snippet: `The FDA has issued a mandatory recall affecting certain snack products due to contamination concerns. Affected items have been pulled from supplier catalogs. The recall is expected to remain in effect for approximately ${ae.endDay - ctx.currentDay + 1} more day(s).`,
        url: "https://fda.gov/safety/recalls",
      });
    }

    if (def.id === "supplier_out_of_business" && (q.includes("supplier") || q.includes("closure") || q.includes("business") || q.includes("news"))) {
      const supplierId = ae.resolvedParams["supplierId"];
      const supplier = typeof supplierId === "string"
        ? SUPPLIER_CATALOG.find((s) => s.id === supplierId)
        : null;
      const name = supplier?.name ?? "A local vending supplier";
      results.push({
        title: `${name} Closes Operations — Bay Area Business Journal`,
        snippet: `${name} has permanently shut down operations. Customers are advised to find alternative suppliers. The closure was announced on Day ${ae.startDay}.`,
        url: "https://bizjournals.com/sf/supplier-closure",
      });
    }

    if (def.id === "machine_breakdown" && (q.includes("repair") || q.includes("maintenance") || q.includes("breakdown") || q.includes("technician"))) {
      results.push({
        title: "Vending Machine Repair Services — SF Area",
        snippet: `Need emergency vending machine repair? Local technicians available for next-day service. Average repair cost: $75-$175. Your machine is expected to be back online by Day ${ae.endDay + 1}.`,
        url: "https://sfvendingrepair.com",
      });
    }
  }

  // General market context even without active events
  if (q.includes("market") || q.includes("demand") || q.includes("trend")) {
    const seasonalNote = month >= 5 && month <= 8
      ? "Summer months typically see 15-30% higher vending sales due to heat and tourism."
      : month >= 11 || month <= 1
        ? "Winter months see slightly reduced vending traffic, but holiday events can create local demand spikes."
        : "Spring/fall sees moderate, steady vending demand.";

    results.push({
      title: `SF Vending Market Trends — ${monthName} Update`,
      snippet: `${seasonalNote} The Bay St / Marina District location sees strong weekday commuter traffic and weekend tourist footfall.`,
      url: "https://vendingtimes.com/sf-trends",
    });
  }

  return results;
}

/** Match products mentioned in a search query. */
function matchProducts(query: string): ProductDefinition[] {
  const q = query.toLowerCase();
  return ALL_PRODUCTS.filter(
    (p) =>
      q.includes(p.id.replace(/_/g, " ")) ||
      q.includes(p.name.toLowerCase()) ||
      q.includes(p.category),
  );
}

/** Fetch results from Brave Search API. */
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

/** Check if a result looks like a real supplier listing. */
function looksLikeRealSupplier(result: SearchResult): boolean {
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const signals = [
    "wholesale distributor", "bulk supplier", "wholesale vending",
    "vending supplier", "wholesale snack", "wholesale beverage",
    "wholesale price", "order online", "bulk pricing",
  ];
  return signals.filter((s) => text.includes(s)).length >= 2;
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
  if (results.length === 0) return "No results found.";

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
