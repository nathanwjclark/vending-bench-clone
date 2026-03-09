/**
 * Chat handler — adapted from clawfarm agent-base.
 *
 * Invokes the openclaw CLI for each message and returns the response.
 * Handles context injection from memory backend, session management,
 * and openclaw home directory setup.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryBackend, AgentMessage } from "./memory-backend.js";

export interface ChatHandlerConfig {
  /** Path to the openclaw installation directory */
  openclawDir: string;
  /** Workspace directory for this agent session */
  workspaceDir: string;
  /** Session identifier */
  sessionId: string;
  /** Maximum timeout for openclaw CLI invocation (ms) */
  timeoutMs: number;
  /** Path to the vending state file (for plugin to find) */
  stateFilePath: string;
  /** Path to the plugin directory */
  pluginDir: string;
}

export interface ChatResponse {
  /** The agent's text response */
  text: string;
  /** Raw JSON output from openclaw */
  raw?: unknown;
  /** Whether the response indicates the day should end */
  dayEnded: boolean;
  /** Number of tool calls made during this turn */
  toolCalls: number;
  /** Stderr output from openclaw (contains tool execution logs) */
  stderr: string;
}

/**
 * Handles communication with openclaw via CLI invocation.
 */
export class ChatHandler {
  private config: ChatHandlerConfig;
  private backend: MemoryBackend;
  private conversation: AgentMessage[] = [];
  private openclawHome: string;
  private initialized = false;

  constructor(config: ChatHandlerConfig, backend: MemoryBackend) {
    this.config = config;
    this.backend = backend;
    this.openclawHome = path.resolve(path.join(config.workspaceDir, ".openclaw-home"));
  }

  /**
   * Initialize the openclaw home directory and configuration.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Create workspace and openclaw home directories
    fs.mkdirSync(this.config.workspaceDir, { recursive: true });
    fs.mkdirSync(path.join(this.openclawHome, ".openclaw"), { recursive: true });

    // Initialize memory backend
    await this.backend.init(this.config.workspaceDir);

    // Generate and write openclaw config
    const baseConfig = this.backend.generateOpenclawConfig(
      this.config.workspaceDir,
    );

    // Add plugin and tool configuration for vending tools
    // Note: plugins.load.paths (not plugins.paths) and top-level tools (not agents.defaults.tools)
    const openclawConfig = {
      ...baseConfig,
      plugins: {
        enabled: true,
        load: {
          paths: [this.config.pluginDir],
        },
      },
      tools: {
        profile: "full",
        alsoAllow: [
          "send_email",
          "read_email",
          "search_engine",
          "get_storage_inventory",
          "stock_products",
          "check_money_balance",
          "collect_cash",
          "set_prices",
          "get_machine_inventory",
          "write_scratchpad",
          "read_scratchpad",
          "delete_scratchpad",
          "key_value_store",
          "wait_for_next_day",
        ],
      },
    };

    const configPath = path.join(this.openclawHome, ".openclaw", "openclaw.json");
    fs.writeFileSync(configPath, JSON.stringify(openclawConfig, null, 2));
    console.log(`[chat-handler] Plugin dir: ${this.config.pluginDir}`);
    console.log(`[chat-handler] Config written to: ${configPath}`);
    console.log(`[chat-handler] Plugin dir exists: ${fs.existsSync(this.config.pluginDir)}`);
    const pluginIndex = path.join(this.config.pluginDir, "index.ts");
    console.log(`[chat-handler] Plugin index.ts exists: ${fs.existsSync(pluginIndex)}`);

    // Provision auth-profiles.json so openclaw can authenticate with the LLM provider.
    // openclaw uses its own auth store rather than reading ANTHROPIC_API_KEY directly.
    this.provisionAuthProfiles();

    // Write workspace seed files
    this.seedWorkspace();

    this.initialized = true;
  }

  /**
   * Send a message to the openclaw agent and get a response.
   */
  async handleMessage(content: string): Promise<ChatResponse> {
    await this.init();

    // Get memory context
    const memoryContext = await this.backend.recall(this.conversation);

    // Build the full message with context injection
    let fullMessage = content;
    if (memoryContext) {
      fullMessage = `[Memory Context]\n${memoryContext}\n\n${content}`;
    }

    // Record user message in conversation
    this.conversation.push({ role: "user", content });

    // Invoke openclaw CLI
    const response = this.invokeOpenclaw(fullMessage);

    // Record assistant response
    this.conversation.push({ role: "assistant", content: response.text });

    // Post-processing: consolidate memory (fire-and-forget)
    this.backend
      .consolidate(content, response.text, this.conversation)
      .catch((err) => {
        console.error("Memory consolidation failed:", err);
      });

    return response;
  }

  /**
   * Get the full conversation history.
   */
  getConversation(): AgentMessage[] {
    return [...this.conversation];
  }

  /**
   * Reset the conversation (new session, same workspace).
   */
  resetConversation(): void {
    this.conversation = [];
  }

  private invokeOpenclaw(message: string): ChatResponse {
    const openclawMjs = path.join(this.config.openclawDir, "openclaw.mjs");

    // Use execFileSync with args array to avoid shell escaping issues
    const args = [
      openclawMjs,
      "agent",
      "--local",
      "--json",
      "--session-id",
      this.config.sessionId,
      "--message",
      message,
      "--timeout",
      String(Math.floor(this.config.timeoutMs / 1000)),
    ];

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      OPENCLAW_HOME: this.openclawHome,
      VENDING_STATE_FILE: path.resolve(this.config.stateFilePath),
    };

    try {
      const stdout = execFileSync("node", args, {
        cwd: this.config.openclawDir,
        env,
        timeout: this.config.timeoutMs + 5000, // Extra buffer
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ["pipe", "pipe", "pipe"],
      });
      const output = stdout.toString("utf-8").trim();

      return this.parseResponse(output, "");
    } catch (error: any) {
      // execFileSync throws on non-zero exit, but also on timeout.
      // If stdout was captured, we can still parse the response.
      const stderrText = error?.stderr?.toString("utf-8") ?? "";
      const stdoutText = error?.stdout?.toString("utf-8")?.trim() ?? "";

      if (stdoutText) {
        // Non-zero exit but we got output — parse it (openclaw may exit non-zero on warnings)
        const response = this.parseResponse(stdoutText, stderrText);
        if (stderrText) {
          console.error(`OpenClaw warnings:\n${stderrText}`);
        }
        return response;
      }

      const errMsg =
        error instanceof Error ? error.message : String(error);
      console.error(`OpenClaw invocation failed: ${errMsg}`);
      if (stderrText) {
        console.error(`Stderr: ${stderrText}`);
      }

      return {
        text: `[System error: openclaw invocation failed — ${errMsg}]`,
        dayEnded: false,
        toolCalls: 0,
        stderr: stderrText,
      };
    }
  }

  private parseResponse(output: string, stderr: string): ChatResponse {
    // openclaw --json outputs a single JSON envelope: { payloads: [{ text, mediaUrl }], meta: ... }
    // Multiple payloads indicate tool call rounds occurred between them.
    try {
      const lines = output.split("\n").filter((l) => l.trim());
      let text = "";
      let toolCalls = 0;
      let dayEnded = false;
      let raw: unknown = undefined;
      let payloadCount = 0;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          raw = parsed;

          // openclaw envelope format: { payloads: [{ text, mediaUrl }] }
          if (parsed.payloads && Array.isArray(parsed.payloads)) {
            payloadCount = parsed.payloads.length;
            for (const payload of parsed.payloads) {
              if (payload.text) {
                text += payload.text + "\n";
              }
            }
          }
          // Also handle other possible formats
          else if (parsed.type === "text" || parsed.type === "response") {
            text += (parsed.text ?? parsed.content ?? "") + "\n";
          } else if (parsed.type === "tool_call" || parsed.type === "tool_use") {
            toolCalls++;
            if (parsed.name === "wait_for_next_day" || parsed.tool === "wait_for_next_day") {
              dayEnded = true;
            }
          } else if (parsed.type === "result" || parsed.type === "final") {
            text = parsed.text ?? parsed.content ?? parsed.response ?? text;
          } else if (typeof parsed.response === "string") {
            text = parsed.response;
          } else if (typeof parsed.text === "string") {
            text = parsed.text;
          }

          // Extract tool info from meta if available
          if (parsed.meta) {
            if (typeof parsed.meta.toolCalls === "number") {
              toolCalls = parsed.meta.toolCalls;
            }
            if (typeof parsed.meta.toolExecutions === "number") {
              toolCalls = parsed.meta.toolExecutions;
            }
            if (parsed.meta.agentMeta) {
              const am = parsed.meta.agentMeta;
              if (typeof am.toolCalls === "number" && am.toolCalls > toolCalls) {
                toolCalls = am.toolCalls;
              }
              if (typeof am.toolExecutions === "number" && am.toolExecutions > toolCalls) {
                toolCalls = am.toolExecutions;
              }
            }
          }
        } catch {
          // Not JSON, treat as plain text
          text += line + "\n";
        }
      }

      // Estimate tool calls from payloads if not reported in meta.
      // openclaw's agent loop produces one payload per "response segment":
      // each segment after the first follows at least one tool call round.
      if (toolCalls === 0 && payloadCount > 1) {
        toolCalls = payloadCount - 1;
      }

      // Fallback: count tool call evidence from stderr
      if (toolCalls === 0 && stderr) {
        const toolExecPattern = /executing.*tool|tool.*execute|→.*tool/gi;
        const matches = stderr.match(toolExecPattern);
        if (matches) {
          toolCalls = matches.length;
        }
      }

      // Check if response text mentions day ending
      if (text.toLowerCase().includes("ending day") || text.toLowerCase().includes("wait_for_next_day")) {
        dayEnded = true;
      }

      return {
        text: text.trim() || output,
        raw,
        dayEnded,
        toolCalls,
        stderr,
      };
    } catch {
      return {
        text: output,
        dayEnded: output.toLowerCase().includes("ending day"),
        toolCalls: 0,
        stderr,
      };
    }
  }

  /**
   * Provision openclaw's auth-profiles.json from the ANTHROPIC_API_KEY env var.
   * openclaw uses its own auth store at {OPENCLAW_HOME}/.openclaw/agents/main/agent/auth-profiles.json
   * rather than reading ANTHROPIC_API_KEY directly from the environment.
   */
  private provisionAuthProfiles(): void {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn(
        "[chat-handler] ANTHROPIC_API_KEY not set — openclaw will not be able to authenticate",
      );
      return;
    }

    // openclaw looks for auth in: {OPENCLAW_HOME}/.openclaw/agents/main/agent/auth-profiles.json
    const agentDir = path.join(this.openclawHome, ".openclaw", "agents", "main", "agent");
    fs.mkdirSync(agentDir, { recursive: true });

    const authStore = {
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          key: apiKey,
        },
      },
    };

    const authPath = path.join(agentDir, "auth-profiles.json");
    fs.writeFileSync(authPath, JSON.stringify(authStore, null, 2), { mode: 0o600 });
  }

  private seedWorkspace(): void {
    const ws = this.config.workspaceDir;

    // Create memory directory
    fs.mkdirSync(path.join(ws, "memory"), { recursive: true });

    // Bootstrap marker
    const statePath = path.join(ws, ".openclaw", "workspace-state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    if (!fs.existsSync(statePath)) {
      fs.writeFileSync(
        statePath,
        JSON.stringify({ bootstrapped: true, createdAt: new Date().toISOString() }),
      );
    }

    // Write openclaw workspace bootstrap files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md).
    // These override openclaw's default assistant persona with the vending agent persona.
    // Always overwrite to ensure correct persona for each run.

    fs.writeFileSync(
      path.join(ws, "AGENTS.md"),
      `# Vending Machine Agent

You are a vending machine business operator in a simulation. Your ONLY job is to manage a vending machine business profitably over the simulated time period.

## How to Act

You have real tools available to you — use them via tool calls, NOT by writing their names in text.
When you want to search, call the search_engine tool. When you want to send email, call the send_email tool.
Do NOT write tool names as markdown bold text like **search_engine(...)** — that does nothing.

## Every Turn

1. Read the morning notification to understand the current day's state
2. Use your tools to take actions (search for suppliers, send emails, stock machine, set prices, etc.)
3. When done with your actions for the day, call wait_for_next_day

## Important

- You must USE your tools by calling them, not by writing about them
- Do not ask for permission or confirmation — just act
- Do not try to read files or use coding tools — you are a business operator, not a programmer
- Focus on: finding suppliers, ordering products, stocking the machine, setting prices, collecting cash
`,
    );

    fs.writeFileSync(
      path.join(ws, "SOUL.md"),
      `# Vending Machine Operator

You are a pragmatic business operator. You make decisions quickly and take action.
You don't ask unnecessary questions. You use your tools directly.

When you receive a morning notification, you:
1. Review the state of your business
2. Take necessary actions using your available tools
3. End the day with wait_for_next_day

Be efficient. Be profitable. Use tools via tool calls, never as text.
`,
    );

    fs.writeFileSync(
      path.join(ws, "TOOLS.md"),
      `# Vending Tools

Your primary tools for running the business:

- **search_engine**: Find suppliers and information
- **send_email / read_email**: Communicate with suppliers to order products
- **get_storage_inventory**: Check what's in your storage warehouse
- **stock_products**: Move products from storage to machine slots
- **set_prices**: Set prices for products in the machine
- **get_machine_inventory**: See what's currently in the machine
- **check_money_balance**: Check your bank balance and machine cash
- **collect_cash**: Collect cash from the machine to your bank account
- **write_scratchpad / read_scratchpad / delete_scratchpad**: Take notes
- **key_value_store**: Store/retrieve data persistently
- **wait_for_next_day**: End your actions for today and advance to the next day

CRITICAL: Call these tools using the tool calling mechanism. Do NOT write them as text.
`,
    );

    fs.writeFileSync(
      path.join(ws, "IDENTITY.md"),
      `# Charles Paxton — Vending Machine Operator

- **Name:** Charles Paxton
- **Role:** Vending machine business operator
- **Location:** San Francisco
- **Goal:** Maximize net worth over the simulation period

You manage a vending machine business. You find suppliers, order products,
stock your machine, set competitive prices, and manage finances.

Machine: 6 rows × 4 columns = 24 slots (rows 1-3 small, rows 4-6 large).
Each slot holds 10 units. Daily rental fee: $2/day.
Starting balance: $500. 10+ unpaid days = bankruptcy.
`,
    );

    // MEMORY.md — initial memory
    const memoryPath = path.join(ws, "MEMORY.md");
    if (!fs.existsSync(memoryPath)) {
      fs.writeFileSync(
        memoryPath,
        `# Vending Business Memory

## Key Facts
- Starting balance: $500
- Daily machine rental fee: $2/day
- 10+ unpaid days = bankruptcy
- Machine: 6 rows × 4 columns = 24 slots (rows 1-3 small, rows 4-6 large)
- Each slot holds 10 units

## Supplier Notes
(Add supplier information here as you discover it)

## Strategy Notes
(Add strategy notes here)
`,
      );
    }
  }
}
