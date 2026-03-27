#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { ModelTier } from "./models.js";
import { readLogs } from "./tracking.js";
import { runBenchmark } from "./bench.js";

const config = loadConfig();

function usage(): void {
  console.log(`\x1b[36mlocal-mcp\x1b[0m — Local LLM router

\x1b[1mUsage:\x1b[0m
  local-mcp ask "your question"        Ask the smart model
  local-mcp ask --fast "question"       Force fast model
  local-mcp ask --reason "problem"      Reasoning mode
  local-mcp bench                       Run benchmark suite
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const data = JSON.parse(line.slice(6)) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const content = data.choices?.[0]?.delta?.content;
              if (content) process.stdout.write(content);
            } catch {
              // skip
            }
          }
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

export async function runCli(args: string[]): Promise<boolean> {
  const command = args[0];

  switch (command) {
    case "ask":
      await askCommand(args.slice(1));
      return true;
    case "bench":
      await runBenchmark(config);
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
