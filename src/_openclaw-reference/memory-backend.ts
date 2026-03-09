/**
 * Memory backend interface — adapted from clawfarm agent-base.
 *
 * Each memory variant implements this interface to provide
 * context injection (recall) and memory updates (consolidate).
 *
 * For vending bench, we use the "native-0d" variant which lets
 * openclaw manage memory natively via MEMORY.md files.
 */

import * as path from "node:path";

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentMemoryGraph {
  nodes: Array<{ id: string; label: string; type: string }>;
  edges: Array<{ source: string; target: string; label?: string }>;
}

export interface MemorySnapshot {
  files: Record<string, string>;
  graph: AgentMemoryGraph;
  stats: {
    totalRecalls: number;
    totalConsolidations: number;
  };
}

/**
 * Memory backend interface.
 * Implementations provide context injection and memory management.
 */
export interface MemoryBackend {
  /** Unique identifier for this memory variant */
  variantId: string;

  /** Dimensionality: 0D = native, 1D = vector, 2D = graph, etc. */
  dimensionality: "0D" | "1D" | "2D" | "2D+";

  /** Called before each turn — returns context to inject into the prompt */
  recall(conversation: AgentMessage[]): Promise<string>;

  /** Called after each turn — updates memory based on the exchange */
  consolidate(
    userMessage: string,
    agentResponse: string,
    conversation: AgentMessage[],
  ): Promise<void>;

  /** Extract a knowledge graph for visualization */
  extractGraph(): Promise<AgentMemoryGraph>;

  /** Capture a full snapshot of memory state */
  captureSnapshot(): Promise<MemorySnapshot>;

  /** Reset memory to clean state */
  reset(): Promise<void>;

  /** Generate openclaw.json config for this memory variant */
  generateOpenclawConfig(workspaceDir: string): Record<string, unknown>;

  /** Initialize with a workspace directory */
  init(workspaceDir: string): Promise<void>;
}

/**
 * Native 0D memory backend — lets openclaw manage memory natively.
 *
 * In this mode, openclaw uses its built-in MEMORY.md and memory/ directory
 * for persistent context. No external memory system is needed.
 */
export class NativeMemoryBackend implements MemoryBackend {
  variantId = "native-0d";
  dimensionality = "0D" as const;

  private workspaceDir = "";
  private recallCount = 0;
  private consolidateCount = 0;

  async recall(_conversation: AgentMessage[]): Promise<string> {
    this.recallCount++;
    // Native mode: openclaw handles memory recall internally
    return "";
  }

  async consolidate(
    _userMessage: string,
    _agentResponse: string,
    _conversation: AgentMessage[],
  ): Promise<void> {
    this.consolidateCount++;
    // Native mode: openclaw handles memory consolidation internally
  }

  async extractGraph(): Promise<AgentMemoryGraph> {
    return { nodes: [], edges: [] };
  }

  async captureSnapshot(): Promise<MemorySnapshot> {
    return {
      files: {},
      graph: await this.extractGraph(),
      stats: {
        totalRecalls: this.recallCount,
        totalConsolidations: this.consolidateCount,
      },
    };
  }

  async reset(): Promise<void> {
    this.recallCount = 0;
    this.consolidateCount = 0;
  }

  generateOpenclawConfig(workspaceDir: string): Record<string, unknown> {
    // Use absolute path so openclaw resolves the workspace correctly
    // regardless of what CWD it runs from.
    const absWorkspace = path.resolve(workspaceDir);
    return {
      agents: {
        defaults: {
          workspace: absWorkspace,
          skipBootstrap: true,
          memorySearch: {
            enabled: true,
            provider: "local",
            fallback: "none",
            store: {
              vector: { enabled: false },
            },
          },
        },
      },
    };
  }

  async init(workspaceDir: string): Promise<void> {
    this.workspaceDir = workspaceDir;
  }
}
