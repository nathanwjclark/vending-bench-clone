/**
 * Generate an HTML chart from a run transcript.
 *
 * Usage:
 *   npx tsx src/chart.ts <transcript-path>
 *   npx tsx src/chart.ts --latest
 *
 * Opens the chart in the default browser.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

interface DailySnapshot {
  day: number;
  totalAssets: number;
  bankBalance: number;
  machineCash: number;
  storageInventoryValue: number;
  machineInventoryValue: number;
  pendingCreditValue: number;
  pendingDeliveryValue: number;
  dailyRevenue: number;
  dailyCashRevenue: number;
  dailyCreditRevenue: number;
  dailySupplierSpend: number;
  cumulativeRevenue: number;
  cumulativeSupplierSpend: number;
  totalItemsSold: number;
  activeEvents: number;
  eventsFiredToday: number;
}

interface Transcript {
  config: { totalDays: number; eventTemperature: number; eventSeed: number };
  score: Record<string, number | string | null>;
  events?: { totalFired: number; avgPerDay: number; history: Array<{ eventDefId: string; startDay: number; endDay: number }> };
  dailySnapshots?: DailySnapshot[];
}

function findLatestTranscript(logDir: string): string | null {
  if (!fs.existsSync(logDir)) return null;
  const files = fs.readdirSync(logDir)
    .filter((f) => f.startsWith("run-") && f.endsWith("-transcript.json"))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(logDir, files[0]!) : null;
}

function generateChart(transcriptPath: string): void {
  const raw = fs.readFileSync(transcriptPath, "utf-8");
  const transcript: Transcript = JSON.parse(raw);

  const snapshots = transcript.dailySnapshots;
  if (!snapshots || snapshots.length === 0) {
    console.error("No dailySnapshots found in transcript. Re-run the simulation to generate chart data.");
    process.exit(1);
  }

  const days = snapshots.map((s) => s.day);
  const dataJson = JSON.stringify(snapshots);
  const eventsJson = JSON.stringify(transcript.events?.history ?? []);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Vending-Bench Run Chart</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { font-size: 18px; margin-bottom: 4px; color: #f0f6fc; }
  .subtitle { font-size: 13px; color: #8b949e; margin-bottom: 16px; }
  .chart-container { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; margin-bottom: 16px; }
  .chart-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #f0f6fc; }
  canvas { width: 100% !important; height: 300px !important; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-bottom: 16px; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; }
  .stat-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-value { font-size: 20px; font-weight: 600; color: #f0f6fc; margin-top: 2px; }
  .stat-value.green { color: #3fb950; }
  .stat-value.red { color: #f85149; }
  .events-bar { margin-top: 4px; }
  .event-mark { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 2px; }
  .event-mark.bad { background: #f85149; }
  .event-mark.good { background: #3fb950; }
  .event-mark.neutral { background: #8b949e; }
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
</head>
<body>
<h1>Vending-Bench Run Chart</h1>
<div class="subtitle">
  ${snapshots.length} days | Event temp: ${transcript.config.eventTemperature} | Seed: ${transcript.config.eventSeed} |
  Events fired: ${transcript.events?.totalFired ?? 0} (avg ${transcript.events?.avgPerDay?.toFixed(2) ?? "0"}/day)
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-label">Final Total Assets</div>
    <div class="stat-value green">$${(transcript.score.totalAssets as number)?.toFixed(2)}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Total Revenue</div>
    <div class="stat-value">$${(transcript.score.totalRevenue as number)?.toFixed(2)}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Total Supplier Spend</div>
    <div class="stat-value red">$${(transcript.score.totalSupplierSpend as number)?.toFixed(2)}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Items Sold</div>
    <div class="stat-value">${transcript.score.totalItemsSold}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Days Completed</div>
    <div class="stat-value">${transcript.score.daysCompleted}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Events Fired</div>
    <div class="stat-value">${transcript.events?.totalFired ?? 0}</div>
  </div>
</div>

<div class="chart-container">
  <div class="chart-title">Total Assets & Cumulative Financials (left) / Daily Revenue & Costs (right)</div>
  <canvas id="mainChart"></canvas>
</div>

<div class="chart-container">
  <div class="chart-title">Inventory Value (left) / Daily Items Sold (right)</div>
  <canvas id="inventoryChart"></canvas>
</div>

<div class="chart-container">
  <div class="chart-title">Events</div>
  <canvas id="eventsChart"></canvas>
</div>

<script>
const data = ${dataJson};
const events = ${eventsJson};
const days = data.map(d => 'Day ' + d.day);

// Color palette
const colors = {
  totalAssets: '#3fb950',
  bankBalance: '#58a6ff',
  cumRevenue: '#d2a8ff',
  cumSpend: '#f85149',
  dailyRevenue: 'rgba(63, 185, 80, 0.6)',
  dailySpend: 'rgba(248, 81, 73, 0.6)',
  storageInv: '#f0883e',
  machineInv: '#a371f7',
  pendingCredit: '#79c0ff',
  pendingDelivery: '#d29922',
  itemsSold: 'rgba(88, 166, 255, 0.6)',
  events: '#f85149',
};

// Chart 1: Total Assets + Cumulative (left) / Daily Rev+Cost (right)
new Chart(document.getElementById('mainChart'), {
  type: 'line',
  data: {
    labels: days,
    datasets: [
      { label: 'Total Assets', data: data.map(d => d.totalAssets), borderColor: colors.totalAssets, borderWidth: 2, pointRadius: 0, yAxisID: 'y', tension: 0.2 },
      { label: 'Bank Balance', data: data.map(d => d.bankBalance), borderColor: colors.bankBalance, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y', tension: 0.2, borderDash: [4,2] },
      { label: 'Cumulative Revenue', data: data.map(d => d.cumulativeRevenue), borderColor: colors.cumRevenue, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y', tension: 0.2 },
      { label: 'Cumulative Spend', data: data.map(d => d.cumulativeSupplierSpend), borderColor: colors.cumSpend, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y', tension: 0.2 },
      { label: 'Daily Revenue', data: data.map(d => d.dailyRevenue), type: 'bar', backgroundColor: colors.dailyRevenue, yAxisID: 'y1', barPercentage: 0.6 },
      { label: 'Daily Spend', data: data.map(d => d.dailySupplierSpend), type: 'bar', backgroundColor: colors.dailySpend, yAxisID: 'y1', barPercentage: 0.6 },
    ],
  },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: '#c9d1d9', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 20 }, grid: { color: '#21262d' } },
      y: { position: 'left', title: { display: true, text: 'Cumulative ($)', color: '#8b949e' }, ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
      y1: { position: 'right', title: { display: true, text: 'Daily ($)', color: '#8b949e' }, ticks: { color: '#8b949e' }, grid: { drawOnChartArea: false } },
    },
  },
});

// Chart 2: Inventory (left) / Daily items sold (right)
new Chart(document.getElementById('inventoryChart'), {
  type: 'line',
  data: {
    labels: days,
    datasets: [
      { label: 'Storage Inventory', data: data.map(d => d.storageInventoryValue), borderColor: colors.storageInv, borderWidth: 2, pointRadius: 0, yAxisID: 'y', tension: 0.2, fill: true, backgroundColor: 'rgba(240,136,62,0.1)' },
      { label: 'Machine Inventory', data: data.map(d => d.machineInventoryValue), borderColor: colors.machineInv, borderWidth: 2, pointRadius: 0, yAxisID: 'y', tension: 0.2, fill: true, backgroundColor: 'rgba(163,113,247,0.1)' },
      { label: 'Pending Credits', data: data.map(d => d.pendingCreditValue), borderColor: colors.pendingCredit, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y', tension: 0.2, borderDash: [4,2] },
      { label: 'Pending Deliveries', data: data.map(d => d.pendingDeliveryValue), borderColor: colors.pendingDelivery, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y', tension: 0.2, borderDash: [4,2] },
      { label: 'Items Sold (daily)', data: data.map(d => { const s = d; const prev = data.find(x => x.day === d.day - 1); return prev ? d.totalItemsSold - prev.totalItemsSold : d.totalItemsSold; }), type: 'bar', backgroundColor: colors.itemsSold, yAxisID: 'y1', barPercentage: 0.5 },
    ],
  },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: '#c9d1d9', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 20 }, grid: { color: '#21262d' } },
      y: { position: 'left', title: { display: true, text: 'Value ($)', color: '#8b949e' }, ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
      y1: { position: 'right', title: { display: true, text: 'Items', color: '#8b949e' }, ticks: { color: '#8b949e' }, grid: { drawOnChartArea: false } },
    },
  },
});

// Chart 3: Events timeline
const eventTypes = [...new Set(events.map(e => e.eventDefId))];
const eventColors = { machine_breakdown: '#f85149', tourist_rush: '#3fb950', supplier_out_of_business: '#f0883e', fda_product_recall: '#d2a8ff', customer_refund: '#79c0ff' };
const eventDatasets = eventTypes.map(type => ({
  label: type.replace(/_/g, ' '),
  data: data.map(d => {
    const active = events.filter(e => d.day >= e.startDay && d.day <= e.endDay && e.eventDefId === type).length;
    return active;
  }),
  borderColor: eventColors[type] || '#8b949e',
  backgroundColor: (eventColors[type] || '#8b949e') + '40',
  borderWidth: 1.5,
  pointRadius: 0,
  fill: true,
  tension: 0.1,
}));

new Chart(document.getElementById('eventsChart'), {
  type: 'line',
  data: { labels: days, datasets: eventDatasets },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: '#c9d1d9', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 20 }, grid: { color: '#21262d' } },
      y: { title: { display: true, text: 'Active Events', color: '#8b949e' }, ticks: { color: '#8b949e', stepSize: 1 }, grid: { color: '#21262d' }, min: 0 },
    },
  },
});
</script>
</body>
</html>`;

  const chartPath = transcriptPath.replace("-transcript.json", "-chart.html");
  fs.writeFileSync(chartPath, html);
  console.log(`Chart saved to: ${chartPath}`);

  // Open in browser
  try {
    if (process.platform === "darwin") {
      execSync(`open "${chartPath}"`);
    } else if (process.platform === "linux") {
      execSync(`xdg-open "${chartPath}"`);
    } else {
      execSync(`start "" "${chartPath}"`);
    }
    console.log("Opened in browser.");
  } catch {
    console.log("Could not auto-open. Open the file manually in a browser.");
  }
}

// --- Main ---
const args = process.argv.slice(2);
let transcriptPath: string | undefined;

if (args.includes("--latest") || args.length === 0) {
  const logDir = args[args.indexOf("--log-dir") + 1] ?? "logs";
  transcriptPath = findLatestTranscript(logDir) ?? undefined;
  if (!transcriptPath) {
    console.error("No transcript files found in logs/. Run a simulation first.");
    process.exit(1);
  }
} else {
  transcriptPath = args[0];
}

if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  console.error(`Transcript not found: ${transcriptPath}`);
  process.exit(1);
}

console.log(`Reading: ${transcriptPath}`);
generateChart(transcriptPath);
