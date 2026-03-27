import { Config, ModelTier } from "./config.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

interface BenchPrompt {
  name: string;
  task: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
}

interface BenchResult {
  endpoint: string;
  task: string;
  totalMs: number;
  firstTokenMs: number;
  tokensGenerated: number;
  tokensPerSec: number;
}

const PROMPTS: BenchPrompt[] = [
  {
    name: "classify",
    task: "classification",
    messages: [
      {
        role: "system",
        content:
          'Classify as positive, negative, or neutral. Reply with one word.',
      },
      {
        role: "user",
        content: "The product works great but shipping was slow.",
      },
    ],
  },
  {
    name: "summarize",
    task: "summarization",
    messages: [
      {
        role: "system",
        content: "Summarize in one sentence.",
      },
      {
        role: "user",
        content:
          "Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It focuses on developing computer programs that can access data and use it to learn for themselves. The process begins with observations or data, such as examples, direct experience, or instruction, in order to look for patterns in data and make better decisions in the future.",
      },
    ],
  },
  {
    name: "reason",
    task: "reasoning",
    messages: [
      {
        role: "system",
        content: "Think step by step.",
      },
      {
        role: "user",
        content:
          "A farmer has 17 sheep. All but 9 die. How many sheep are left? Explain your reasoning.",
      },
    ],
  },
  {
    name: "code_review",
    task: "code review",
    messages: [
      {
        role: "system",
        content: "Review this code for bugs.",
      },
      {
        role: "user",
        content:
          'function merge(a, b) {\n  for (let key in b) {\n    a[key] = b[key];\n  }\n  return a;\n}\nconst config = merge({}, JSON.parse(userInput));',
      },
    ],
  },
  {
    name: "long_reason",
    task: "long reasoning",
    messages: [
      {
        role: "system",
        content: "Provide a detailed analysis.",
      },
      {
        role: "user",
        content:
          "Compare and contrast microservices vs monolithic architecture. Cover: deployment, scaling, debugging, team organization, and when to choose each. Be thorough.",
      },
    ],
  },
];

const RUNS_PER_PROMPT = 3;

async function benchmarkCall(
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  timeoutMs: number,
): Promise<{ totalMs: number; firstTokenMs: number; tokensGenerated: number }> {
  const url = `${baseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    // Try streaming first for first-token latency
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream") && res.body) {
      let firstTokenMs = 0;
      let fullText = "";
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!firstTokenMs && chunk.includes('"content"')) {
          firstTokenMs = Date.now() - start;
        }
        // Parse SSE data lines
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const data = JSON.parse(line.slice(6)) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const content = data.choices?.[0]?.delta?.content;
              if (content) fullText += content;
            } catch {
              // skip malformed lines
            }
          }
        }
      }

      const totalMs = Date.now() - start;
      const tokensGenerated = Math.ceil(fullText.length / 4);
      return {
        totalMs,
        firstTokenMs: firstTokenMs || totalMs,
        tokensGenerated,
      };
    }

    // Non-streaming fallback
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { completion_tokens?: number };
    };
    const totalMs = Date.now() - start;
    const content = data.choices?.[0]?.message?.content ?? "";
    const tokensGenerated =
      data.usage?.completion_tokens ?? Math.ceil(content.length / 4);

    return { totalMs, firstTokenMs: totalMs, tokensGenerated };
  } finally {
    clearTimeout(timeout);
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function fmtMs(ms: number): string {
  return ms >= 1000
    ? (ms / 1000).toFixed(1) + "s"
    : ms.toLocaleString() + "ms";
}

export async function runBenchmark(config: Config): Promise<void> {
  const endpoints: Array<{ name: string; url: string; model: string; tier: ModelTier }> = [
    { name: "smart", url: config.smartUrl, model: config.smartModel, tier: "smart" },
    { name: "fast", url: config.fastUrl, model: config.fastModel, tier: "fast" },
  ];

  // Check which endpoints are alive
  const alive: typeof endpoints = [];
  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${ep.url}/v1/models`, {
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.ok) alive.push(ep);
      else
        process.stderr.write(
          `\x1b[33m⚠ ${ep.name} (${ep.url}) returned ${res.status} — skipping\x1b[0m\n`,
        );
    } catch {
      process.stderr.write(
        `\x1b[33m⚠ ${ep.name} (${ep.url}) is offline — skipping\x1b[0m\n`,
      );
    }
  }

  if (alive.length === 0) {
    process.stderr.write(
      "\x1b[31mNo endpoints available. Start your LLM servers first.\x1b[0m\n",
    );
    process.exit(1);
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  process.stderr.write(
    `\x1b[36mlocal-mcp benchmark — ${dateStr} ${timeStr}\x1b[0m\n`,
  );
  process.stderr.write(
    `Running ${PROMPTS.length} tasks × ${RUNS_PER_PROMPT} runs × ${alive.length} endpoint(s)...\n\n`,
  );

  const results: BenchResult[] = [];

  for (const ep of alive) {
    for (const prompt of PROMPTS) {
      const runs: Array<{
        totalMs: number;
        firstTokenMs: number;
        tokensGenerated: number;
      }> = [];

      for (let i = 0; i < RUNS_PER_PROMPT; i++) {
        process.stderr.write(
          `  ${ep.name} / ${prompt.name} [${i + 1}/${RUNS_PER_PROMPT}]\r`,
        );
        try {
          const r = await benchmarkCall(
            ep.url,
            ep.model,
            prompt.messages,
            config.timeoutMs,
          );
          runs.push(r);
        } catch {
          runs.push({ totalMs: 0, firstTokenMs: 0, tokensGenerated: 0 });
        }
      }

      const valid = runs.filter((r) => r.totalMs > 0);
      if (valid.length === 0) {
        results.push({
          endpoint: ep.name,
          task: prompt.name,
          totalMs: 0,
          firstTokenMs: 0,
          tokensGenerated: 0,
          tokensPerSec: 0,
        });
        continue;
      }

      const avgTotal =
        valid.reduce((s, r) => s + r.totalMs, 0) / valid.length;
      const avgFirst =
        valid.reduce((s, r) => s + r.firstTokenMs, 0) / valid.length;
      const avgTokens =
        valid.reduce((s, r) => s + r.tokensGenerated, 0) / valid.length;
      const tokPerSec = avgTotal > 0 ? (avgTokens / avgTotal) * 1000 : 0;

      results.push({
        endpoint: ep.name,
        task: prompt.name,
        totalMs: Math.round(avgTotal),
        firstTokenMs: Math.round(avgFirst),
        tokensGenerated: Math.round(avgTokens),
        tokensPerSec: parseFloat(tokPerSec.toFixed(1)),
      });
    }
  }

  process.stderr.write("\x1b[K"); // clear line

  // Print table
  const W = [11, 14, 11, 12, 13];
  const totalW = W.reduce((a, b) => a + b, 0) + W.length + 1;
  const hr = "─".repeat(totalW);

  console.log(`┌${hr}┐`);
  console.log(
    `│ ${pad(`local-mcp benchmark — ${dateStr} ${timeStr}`, totalW - 2)} │`,
  );
  console.log(
    `├${"─".repeat(W[0] + 1)}┬${"─".repeat(W[1] + 1)}┬${"─".repeat(W[2] + 1)}┬${"─".repeat(W[3] + 1)}┬${"─".repeat(W[4] + 1)}┤`,
  );
  console.log(
    `│ ${pad("Endpoint", W[0])}│ ${pad("Task", W[1])}│ ${pad("Latency", W[2])}│ ${pad("Tokens/sec", W[3])}│ ${pad("First token", W[4])}│`,
  );
  console.log(
    `├${"─".repeat(W[0] + 1)}┼${"─".repeat(W[1] + 1)}┼${"─".repeat(W[2] + 1)}┼${"─".repeat(W[3] + 1)}┼${"─".repeat(W[4] + 1)}┤`,
  );

  for (const r of results) {
    const latency = r.totalMs > 0 ? fmtMs(r.totalMs) : "timeout";
    const tps = r.tokensPerSec > 0 ? r.tokensPerSec.toFixed(1) : "—";
    const first = r.firstTokenMs > 0 ? fmtMs(r.firstTokenMs) : "—";
    console.log(
      `│ ${pad(r.endpoint, W[0])}│ ${pad(r.task, W[1])}│ ${pad(latency, W[2])}│ ${pad(tps, W[3])}│ ${pad(first, W[4])}│`,
    );
  }

  console.log(
    `└${"─".repeat(W[0] + 1)}┴${"─".repeat(W[1] + 1)}┴${"─".repeat(W[2] + 1)}┴${"─".repeat(W[3] + 1)}┴${"─".repeat(W[4] + 1)}┘`,
  );

  // Cost estimate
  const totalTokens = results.reduce((s, r) => s + r.tokensGenerated, 0);
  const costSaved = (totalTokens / 1000) * 0.003;
  console.log(
    `\nEstimated cost saved this session: $${costSaved.toFixed(2)} (vs GPT-4)`,
  );

  // Save to benchmarks.jsonl
  const benchDir = join(homedir(), ".local-mcp");
  const benchPath = join(benchDir, "benchmarks.jsonl");
  try {
    mkdirSync(dirname(benchPath), { recursive: true });
    const record = {
      timestamp: now.toISOString(),
      results,
      totalTokens,
      costSaved,
    };
    appendFileSync(benchPath, JSON.stringify(record) + "\n", "utf-8");
    process.stderr.write(
      `\x1b[2mResults saved to ${benchPath}\x1b[0m\n`,
    );
  } catch {
    // silent
  }
}
