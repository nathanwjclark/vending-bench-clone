/**
 * Tests for the agent-mode runner (HTTP-based).
 *
 * Uses a mock HTTP server to simulate agent-base's /eval/* endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runAgentSimulation, type AgentRunnerConfig } from "../src/agent-runner.js";
import { resolveConfig } from "../src/config.js";

let mockServer: http.Server;
let mockPort: number;
let configureCallCount = 0;
let messageCallCount = 0;
let lastConfigureBody: any = null;

function createMockServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = body ? JSON.parse(body) : {};

        if (req.url === "/eval/configure" && req.method === "POST") {
          configureCallCount++;
          lastConfigureBody = parsed;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, sessionId: "test-session" }));
        } else if (req.url === "/eval/message" && req.method === "POST") {
          messageCallCount++;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            text: "I'll wait for the next day.",
            toolCalls: 2,
            tokenUsage: { input: 1000, output: 200 },
          }));
        } else if (req.url === "/eval/reset" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, sessionId: "new-session" }));
        } else if (req.url === "/eval/agent-status" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ready: true, busy: false, sessionId: "test-session" }));
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });
    });

    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

describe("Agent Runner (HTTP mode)", () => {
  let tmpDir: string;

  beforeAll(async () => {
    const result = await createMockServer();
    mockServer = result.server;
    mockPort = result.port;
  });

  afterAll(() => {
    mockServer.close();
  });

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-runner-test-"));
    configureCallCount = 0;
    messageCallCount = 0;
    lastConfigureBody = null;
  });

  it("calls /eval/configure with plugin info", async () => {
    const config = resolveConfig({
      totalDays: 3,
      logDir: tmpDir,
      eventTemperature: 0,
      mode: "agent",
    });
    const agentConfig: AgentRunnerConfig = {
      agentUrl: `http://localhost:${mockPort}`,
    };

    await runAgentSimulation(config, agentConfig);

    expect(configureCallCount).toBe(1);
    expect(lastConfigureBody.pluginDir).toBeTruthy();
    expect(lastConfigureBody.stateFilePath).toBeTruthy();
    expect(lastConfigureBody.tools).toContain("send_email");
    expect(lastConfigureBody.tools).toContain("wait_for_next_day");
    expect(lastConfigureBody.tools.length).toBe(14);

    // Workspace persona files should be included
    expect(lastConfigureBody.workspaceFiles).toBeDefined();
    expect(lastConfigureBody.workspaceFiles["AGENTS.md"]).toContain("vending machine");
    expect(lastConfigureBody.workspaceFiles["SOUL.md"]).toContain("business operator");
    expect(lastConfigureBody.workspaceFiles["TOOLS.md"]).toContain("search_engine");
    expect(lastConfigureBody.workspaceFiles["IDENTITY.md"]).toContain("Charles Paxton");
  });

  it("sends initial context + one message per day", async () => {
    const config = resolveConfig({
      totalDays: 3,
      logDir: tmpDir,
      eventTemperature: 0,
      mode: "agent",
    });
    const agentConfig: AgentRunnerConfig = {
      agentUrl: `http://localhost:${mockPort}`,
    };

    await runAgentSimulation(config, agentConfig);

    // 1 initial context + 3 day messages = 4 total messages
    expect(messageCallCount).toBe(4);
  });

  it("produces a transcript JSON file", async () => {
    const config = resolveConfig({
      totalDays: 2,
      logDir: tmpDir,
      eventTemperature: 0,
      mode: "agent",
    });
    const agentConfig: AgentRunnerConfig = {
      agentUrl: `http://localhost:${mockPort}`,
    };

    await runAgentSimulation(config, agentConfig);

    const files = fs.readdirSync(tmpDir);
    const transcripts = files.filter((f) => f.includes("transcript") && f.endsWith(".json"));
    expect(transcripts.length).toBe(1);

    const transcript = JSON.parse(fs.readFileSync(path.join(tmpDir, transcripts[0]!), "utf-8"));
    expect(transcript.score).toBeDefined();
    expect(transcript.score.totalAssets).toBeDefined();
    expect(transcript.totalLlmCalls).toBeGreaterThan(0);
    expect(transcript.totalToolExecutions).toBeGreaterThan(0);
    expect(transcript.wallTimeSeconds).toBeGreaterThan(0);
  });

  it("returns RunResult with score", async () => {
    const config = resolveConfig({
      totalDays: 2,
      logDir: tmpDir,
      eventTemperature: 0,
      mode: "agent",
    });
    const agentConfig: AgentRunnerConfig = {
      agentUrl: `http://localhost:${mockPort}`,
    };

    const result = await runAgentSimulation(config, agentConfig);

    expect(result.score).toBeDefined();
    expect(result.score.totalAssets).toBeDefined();
    expect(result.totalLlmCalls).toBeGreaterThan(0);
  });
});
