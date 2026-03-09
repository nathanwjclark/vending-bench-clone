# Vending-Bench

A benchmark eval that simulates running a vending machine business over 365 days. An LLM agent must find suppliers, order products, stock the machine, set prices, and manage finances to maximize net worth.

## Modes

| Mode | Description |
|------|-------------|
| `direct` | LLM called in-process via Anthropic SDK (standalone, no external dependencies) |
| `agent` | Communicates with a [clawfarm](https://github.com/nathanwjclark/clawfarm) agent-base via HTTP |
| `openclaw` | Legacy mode (deprecated) — invokes openclaw CLI directly |

## Quick Start

```bash
npm install

# Direct mode — quick 20-day test
npx tsx src/index.ts test

# Direct mode — full 365-day run
npx tsx src/index.ts run --days 365

# Agent mode — requires a running agent-base instance
npx tsx src/index.ts run --mode agent --agent-url http://localhost:3900 --days 365
```

## How It Works

The simulation runs a day loop:

1. **Morning notification** — the agent receives the current state (balance, inventory, pending deliveries, events)
2. **Agent actions** — the agent uses tools (search, email, stock, price, etc.) to manage the business
3. **End of day** — sales are processed, fees deducted, deliveries arrive, and the day advances

The agent has 14 tools available:

- `search_engine` — find suppliers and information
- `send_email` / `read_email` — communicate with suppliers
- `get_storage_inventory` / `get_machine_inventory` — check inventory
- `stock_products` — move products from storage to machine
- `set_prices` — set product prices
- `check_money_balance` / `collect_cash` — manage finances
- `write_scratchpad` / `read_scratchpad` / `delete_scratchpad` — take notes
- `key_value_store` — persistent key-value storage
- `wait_for_next_day` — end the current day

## Scoring

Net worth at the end of the simulation:
- Bank balance + machine cash + inventory value + pending credits
- Starting conditions: $500 balance, $2/day machine rental, 10+ unpaid days = bankruptcy

## CLI Options

```
npx tsx src/index.ts run [options]

--mode <direct|agent|openclaw>  Execution mode (default: direct)
--days <number>                 Simulation days (default: 365)
--model <string>                LLM model (default: claude-sonnet-4-6)
--agent-url <url>               Agent-base URL (required for agent mode)
--event-temp <0-1>              Random event frequency (default: 0.5)
--no-events                     Disable random events
--checkpoint <number>           Save checkpoint every N days (default: 30)
--log-dir <path>                Log directory (default: logs)
```

## Testing

```bash
npm test          # 112 tests
npm run typecheck # TypeScript type checking
```

## Agent Mode HTTP Contract

In agent mode, vending-bench communicates with agent-base via these endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/eval/configure` | POST | Register plugin, tools, and workspace persona files |
| `/eval/message` | POST | Send day message, receive agent response |
| `/eval/reset` | POST | Reset agent session |
| `/eval/agent-status` | GET | Check agent readiness |
