#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { ModelTier } from "./models.js";
import { readLogs } from "./tracking.js";
import { runBenchmark } from "./bench.js";
import { detectHardware, FitLevel } from "./hardware.js";
import { getConfigFile, saveConfigFile } from "./config.js";

const config = loadConfig();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function usage(): void {
  console.log(`\x1b[36mlocal-mcp\x1b[0m — Local LLM router

\x1b[1mUsage:\x1b[0m
  local-mcp ask "your question"        Ask the smart model
  local-mcp ask --fast "question"       Force fast model
  local-mcp ask --reason "problem"      Reasoning mode
  local-mcp bench                       Run benchmark suite
  local-mcp fit                         Scan hardware and score curated models
  local-mcp init                        Detect hardware and write a starter config
  local-mcp status                      Print endpoint health
  local-mcp logs                        Tail the request log
  local-mcp dashboard                   Start web dashboard
  local-mcp start                       Start MCP server + dashboard
  local-mcp serve                       Start MCP server only (stdio)
`);
}

async function askCommand(args: string[]): Promise<void> {
  let tier: ModelTier = "smart";
  let reasoning = false;
  const promptParts: string[] = [];

  for (const arg of args) {
    if (arg === "--fast") {
      tier = "fast";
    } else if (arg === "--reason") {
      reasoning = true;
    } else if (!arg.startsWith("--")) {
      promptParts.push(arg);
    }
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    process.stderr.write("Error: no prompt provided\n");
    process.exit(1);
  }

  const baseUrl = tier === "smart" ? config.smartUrl : config.fastUrl;
  const model = tier === "smart" ? config.smartModel : config.fastModel;
  const url = `${baseUrl}/v1/chat/completions`;

  const messages: Array<{ role: string; content: string }> = [];
  if (reasoning) {
    messages.push({
      role: "system",
      content:
        "Think step by step. Be thorough and precise in your reasoning.",
    });
  }
  messages.push({ role: "user", content: prompt });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      process.stderr.write(
        `Error: LLM server returned ${res.status}: ${body || res.statusText}\n`,
      );
      process.exit(1);
    }

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream") && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      const flushLines = (): void => {
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) {
            continue;
          }

          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            sawDone = true;
            continue;
          }

          try {
            const data = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              process.stdout.write(content);
            }
          } catch {
            // Skip malformed chunks
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        flushLines();
      }
      buffer += decoder.decode();
      flushLines();
      if (!sawDone && buffer.trim()) {
        const data = JSON.parse(buffer) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content ?? "";
        if (content) {
          process.stdout.write(content.trim());
        }
      }
      process.stdout.write("\n");
    } else {
      // Non-streaming fallback
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      process.stdout.write(content.trim() + "\n");
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      process.stderr.write(
        `Error: request timed out after ${config.timeoutMs}ms\n`,
      );
    } else if (
      err instanceof TypeError &&
      (err.message.includes("fetch failed") ||
        err.message.includes("ECONNREFUSED"))
    ) {
      process.stderr.write(
        `Error: cannot connect to ${tier} model at ${baseUrl}. Is the LLM server running?\n`,
      );
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
    }
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

function getServerEntryPath(): string {
  const builtPath = join(__dirname, "index.js");
  return builtPath;
}

async function initCommand(): Promise<void> {
  const hardware = detectHardware();
  printFitTable(hardware);

  const current = getConfigFile();
  const nextConfig = {
    ...current,
    endpoints: {
      smart: {
        url: "http://localhost:8081",
        model: hardware.recommended.smart ?? current.endpoints.smart.model,
      },
      fast: {
        url: "http://localhost:8083",
        model: hardware.recommended.fast ?? current.endpoints.fast.model,
      },
    },
  };

  saveConfigFile(nextConfig);

  const serverPath = getServerEntryPath();
  const smartModel = nextConfig.endpoints.smart.model;
  const fastModel = nextConfig.endpoints.fast.model;

  console.log("\nWrote ~/.local-mcp/config.json with recommended endpoints:");
  console.log(`  smart -> ${smartModel} @ ${nextConfig.endpoints.smart.url}`);
  console.log(`  fast  -> ${fastModel} @ ${nextConfig.endpoints.fast.url}`);

  console.log("\nStart these MLX servers:");
  console.log(`  python3 -m mlx_lm.server --model ${smartModel} --port 8081`);
  console.log(`  python3 -m mlx_lm.server --model ${fastModel} --port 8083`);

  console.log("\nRegister with Claude Code:");
  console.log(`  claude mcp add local-mcp -- node ${serverPath} serve`);
}

async function statusCommand(): Promise<void> {
  const endpoints = [
    { name: "smart", url: config.smartUrl, model: config.smartModel },
    { name: "fast", url: config.fastUrl, model: config.fastModel },
  ];

  for (const ep of endpoints) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${ep.url}/v1/models`, {
        signal: controller.signal,
      });
      clearTimeout(t);
      const ms = Date.now() - start;

      if (res.ok) {
        console.log(
          `\x1b[32m●\x1b[0m ${ep.name.padEnd(6)} \x1b[2m${ep.url}\x1b[0m  ${ms}ms  \x1b[36m${ep.model}\x1b[0m`,
        );
      } else {
        console.log(
          `\x1b[33m●\x1b[0m ${ep.name.padEnd(6)} \x1b[2m${ep.url}\x1b[0m  HTTP ${res.status}`,
        );
      }
    } catch {
      console.log(
        `\x1b[31m●\x1b[0m ${ep.name.padEnd(6)} \x1b[2m${ep.url}\x1b[0m  offline`,
      );
    }
  }
}

function logsCommand(): void {
  const logs = readLogs(config.tracking.logPath, 50);
  if (logs.length === 0) {
    console.log("No requests logged yet.");
    return;
  }

  for (const l of logs) {
    const time = new Date(l.timestamp).toLocaleTimeString();
    const statusColor = l.status === "ok" ? "\x1b[32m" : "\x1b[31m";
    const modelShort = l.model?.split("/").pop() ?? "—";
    console.log(
      `${time}  ${statusColor}${l.status.padEnd(5)}\x1b[0m  ${l.tool.padEnd(14)}  ${String(l.tokens).padStart(5)} tok  ${String(l.latencyMs).padStart(6)}ms  \x1b[2m${modelShort}\x1b[0m`,
    );
  }
}

function fitLabel(fit: FitLevel): string {
  switch (fit) {
    case "perfect":
      return "\x1b[32m✅ perfect\x1b[0m";
    case "good":
      return "\x1b[33m🟡 good\x1b[0m";
    case "marginal":
      return "\x1b[38;5;214m🟠 marginal\x1b[0m";
    case "too_large":
      return "\x1b[31m⛔ too_large\x1b[0m";
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

function printFitTable(hardware = detectHardware()): void {
  const widths = [42, 7, 8, 14, 7];
  const topWidth = 77;
  const topLine = `local-mcp fit — Hardware: ${hardware.cpu}  |  RAM: ${hardware.totalRamGB} GB  |  Free: ${hardware.freeRamGB} GB`;

  console.log(`┌${"─".repeat(topWidth)}┐`);
  console.log(`│  ${pad(topLine, topWidth - 2)}│`);
  console.log(
    `├${"─".repeat(widths[0] + 1)}┬${"─".repeat(widths[1] + 1)}┬${"─".repeat(widths[2] + 1)}┬${"─".repeat(widths[3] + 1)}┬${"─".repeat(widths[4] + 1)}┤`,
  );
  console.log(
    `│ ${pad("Model", widths[0])}│ ${pad("RAM", widths[1])}│ ${pad("t/s", widths[2])}│ ${pad("Fit", widths[3])}│ ${pad("Tier", widths[4])}│`,
  );
  console.log(
    `├${"─".repeat(widths[0] + 1)}┼${"─".repeat(widths[1] + 1)}┼${"─".repeat(widths[2] + 1)}┼${"─".repeat(widths[3] + 1)}┼${"─".repeat(widths[4] + 1)}┤`,
  );

  for (const model of hardware.models) {
    const displayName = `${model.name}${model.recommended ? " ⭐" : ""}`;
    console.log(
      `│ ${pad(displayName, widths[0])}│ ${pad(model.ram.replace(" ", ""), widths[1])}│ ${pad(String(model.speedTps), widths[2])}│ ${pad(fitLabel(model.fit), widths[3])}│ ${pad(model.tier, widths[4])}│`,
    );
  }

  console.log(
    `└${"─".repeat(widths[0] + 1)}┴${"─".repeat(widths[1] + 1)}┴${"─".repeat(widths[2] + 1)}┴${"─".repeat(widths[3] + 1)}┴${"─".repeat(widths[4] + 1)}┘`,
  );

  console.log("\nRecommended for this machine:");
  console.log(
    `  Smart model:  ${hardware.recommended.smart ?? "None"}${hardware.recommended.smart ? " (best quality that fits well)" : ""}`,
  );
  console.log(
    `  Fast model:   ${hardware.recommended.fast ?? "None"}${hardware.recommended.fast ? " (fastest)" : ""}`,
  );

  if (hardware.recommended.smart || hardware.recommended.fast) {
    console.log("\nTo start servers:");
    if (hardware.recommended.smart) {
      console.log(
        `  python3 -m mlx_lm server --model ${hardware.recommended.smart} --port 8081`,
      );
    }
    if (hardware.recommended.fast) {
      console.log(
        `  python3 -m mlx_lm server --model ${hardware.recommended.fast} --port 8083`,
      );
    }
  }
}

export async function runCli(args: string[]): Promise<boolean> {
  const command = args[0];

  switch (command) {
    case "ask":
      await askCommand(args.slice(1));
      return true;
    case "bench":
      await runBenchmark(config);
      return true;
    case "fit":
      printFitTable();
      return true;
    case "init":
      await initCommand();
      return true;
    case "status":
      await statusCommand();
      return true;
    case "logs":
      logsCommand();
      return true;
    case "--help":
    case "-h":
    case "help":
      usage();
      return true;
    default:
      return false;
  }
}

if (process.argv[1] === __filename) {
  const handled = await runCli(process.argv.slice(2));
  if (!handled) {
    usage();
    process.exit(1);
  }
}
