import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Config, getConfigFile, updateConfigFile, ConfigFile, ModelTier } from "./config.js";
import { readLogs, getStats } from "./tracking.js";
import { chatCompletion } from "./models.js";
import { loadTemplates, DEFAULT_TEMPLATES } from "./templates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const MODEL_LIBRARY = [
  {
    id: "mlx-community/Qwen2.5-1.5B-Instruct-4bit",
    name: "Qwen 2.5 1.5B",
    ram: "1 GB",
    ramGB: 1,
    speed: "215 t/s",
    bestFor: "Ultra-fast: classification & extraction",
    tags: ["fast", "classification", "extraction"],
  },
  {
    id: "mlx-community/Qwen2.5-7B-Instruct-4bit",
    name: "Qwen 2.5 7B",
    ram: "4.4 GB",
    ramGB: 4.4,
    speed: "60 t/s",
    bestFor: "General Q&A, structured output",
    tags: ["general", "qa", "structured"],
  },
  {
    id: "mlx-community/Qwen3.5-9B-MLX-4bit",
    name: "Qwen 3.5 9B",
    ram: "5.6 GB",
    ramGB: 5.6,
    speed: "52 t/s",
    recommended: true,
    bestFor: "Reasoning & hard prompts",
    tags: ["reasoning", "smart", "recommended"],
  },
  {
    id: "mlx-community/Qwen3-14B-4bit",
    name: "Qwen 3 14B",
    ram: "8.4 GB",
    ramGB: 8.4,
    speed: "29 t/s",
    bestFor: "Mid-tier reasoning",
    tags: ["reasoning", "mid-tier"],
  },
  {
    id: "mlx-community/Qwen3.5-27B-4bit",
    name: "Qwen 3.5 27B",
    ram: "15.3 GB",
    ramGB: 15.3,
    speed: "16 t/s",
    bestFor: "Max quality on-device",
    tags: ["quality", "max"],
  },
  {
    id: "mlx-community/gemma-3-12b-it-4bit",
    name: "Gemma 3 12B",
    ram: "7.3 GB",
    ramGB: 7.3,
    speed: "30 t/s",
    bestFor: "Vision & OCR",
    tags: ["vision", "ocr", "multimodal"],
  },
  {
    id: "mlx-community/Phi-4-reasoning-plus-4bit",
    name: "Phi-4 Reasoning Plus",
    ram: "9.7 GB",
    ramGB: 9.7,
    speed: "26 t/s",
    bestFor: "Deep math & reasoning",
    tags: ["reasoning", "math", "deep"],
  },
];

const VALID_TOOLS = [
  "ask_local",
  "reason",
  "classify",
  "summarize",
  "code_review",
  "explain",
  "extract",
  "translate",
  "diff_analysis",
];

const TOOL_TIER_MAP: Record<string, string> = {
  ask_local: "ask",
  reason: "reason",
  classify: "classify",
  summarize: "summarize",
  code_review: "code_review",
  explain: "explain",
  extract: "extract",
  translate: "translate",
  diff_analysis: "diff_analysis",
};

async function checkEndpointHealth(
  url: string,
): Promise<{ healthy: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${url}/v1/models`, { signal: controller.signal });
    clearTimeout(timeout);
    return { healthy: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { healthy: false, latencyMs: Date.now() - start };
  }
}

function checkSetup(): Record<string, { installed: boolean; version: string }> {
  const checks: Record<string, { installed: boolean; version: string }> = {};
  for (const cmd of ["python3", "pip3"]) {
    try {
      const version = execSync(`${cmd} --version 2>&1`, { encoding: "utf-8" }).trim();
      checks[cmd] = { installed: true, version };
    } catch {
      checks[cmd] = { installed: false, version: "" };
    }
  }
  try {
    const version = execSync("python3 -c \"import mlx_lm; print(mlx_lm.__version__)\" 2>&1", {
      encoding: "utf-8",
    }).trim();
    checks["mlx_lm"] = { installed: true, version };
  } catch {
    checks["mlx_lm"] = { installed: false, version: "" };
  }
  return checks;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function buildTestMessages(
  tool: string,
  input: string,
): { messages: Array<{ role: "system" | "user"; content: string }>; tier: string } {
  const tierKey = TOOL_TIER_MAP[tool] ?? "ask";
  switch (tool) {
    case "reason":
      return {
        messages: [
          { role: "system", content: "Think step by step. Be thorough and precise in your reasoning." },
          { role: "user", content: input },
        ],
        tier: tierKey,
      };
    case "classify":
      return {
        messages: [
          { role: "system", content: "Classify the following text. Respond with ONLY a JSON object: {\"result\": \"category\", \"confidence\": \"high|medium|low\"}" },
          { role: "user", content: input },
        ],
        tier: tierKey,
      };
    case "summarize":
      return {
        messages: [
          { role: "system", content: "Summarize the following text in a concise paragraph. Respond with only the summary." },
          { role: "user", content: input },
        ],
        tier: tierKey,
      };
    case "code_review":
      return {
        messages: [
          { role: "system", content: "You are an expert code reviewer. Review the following code for bugs, performance, and style. Provide specific, actionable feedback." },
          { role: "user", content: input },
        ],
        tier: tierKey,
      };
    case "explain":
      return {
        messages: [
          { role: "system", content: "Explain the following clearly for an intermediate-level audience. Be concise but thorough." },
          { role: "user", content: input },
        ],
        tier: tierKey,
      };
    case "extract":
      return {
        messages: [
          { role: "system", content: "Extract structured data from the following text. Output ONLY valid JSON." },
          { role: "user", content: input },
        ],
        tier: tierKey,
      };
    case "translate":
      return {
        messages: [
          { role: "system", content: "Translate the following text. Output only the translation." },
          { role: "user", content: input },
        ],
        tier: tierKey,
      };
    case "diff_analysis":
      return {
        messages: [
          { role: "system", content: "Analyze this git diff. Respond with ONLY a JSON object: {\"summary\": \"...\", \"risks\": [...], \"suggestions\": [...]}" },
          { role: "user", content: input },
        ],
        tier: tierKey,
      };
    default:
      return {
        messages: [{ role: "user", content: input }],
        tier: tierKey,
      };
  }
}

export function startDashboard(config: Config): void {
  // Resolve dashboard static files — check src/ first (dev), then dist/ (built)
  let staticDir = join(__dirname, "dashboard");
  if (!existsSync(join(staticDir, "index.html"))) {
    staticDir = join(__dirname, "..", "src", "dashboard");
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // API routes
    if (url.startsWith("/api/")) {
      try {
        if (url === "/api/status" && method === "GET") {
          const [smart, fast] = await Promise.all([
            checkEndpointHealth(config.smartUrl),
            checkEndpointHealth(config.fastUrl),
          ]);
          return json(res, {
            smart: { ...smart, url: config.smartUrl, model: config.smartModel },
            fast: { ...fast, url: config.fastUrl, model: config.fastModel },
          });
        }

        if (url === "/api/config" && method === "GET") {
          return json(res, getConfigFile());
        }

        if (url === "/api/config" && method === "POST") {
          const body = await readBody(req);
          const updates = JSON.parse(body) as Partial<ConfigFile>;
          const merged = updateConfigFile(updates);
          return json(res, merged);
        }

        if (url === "/api/logs" && method === "GET") {
          return json(res, readLogs(config.tracking.logPath));
        }

        if (url === "/api/check-setup" && method === "GET") {
          return json(res, checkSetup());
        }

        if (url === "/api/models" && method === "GET") {
          return json(res, MODEL_LIBRARY);
        }

        if (url === "/api/stats" && method === "GET") {
          return json(res, getStats(config.tracking.logPath));
        }

        if (url === "/api/templates" && method === "GET") {
          return json(res, {
            templates: loadTemplates(),
            defaults: DEFAULT_TEMPLATES,
          });
        }

        if (url === "/api/templates" && method === "POST") {
          const body = await readBody(req);
          const { templates } = JSON.parse(body) as { templates: Record<string, string> };
          updateConfigFile({ templates } as unknown as Partial<ConfigFile>);
          return json(res, { ok: true });
        }

        if (url === "/api/test" && method === "POST") {
          const body = await readBody(req);
          const { tool, input } = JSON.parse(body) as { tool: string; input: string };

          if (!VALID_TOOLS.includes(tool)) {
            return json(res, { error: `Invalid tool: ${tool}` }, 400);
          }
          if (!input || !input.trim()) {
            return json(res, { error: "Input is required" }, 400);
          }

          const { messages, tier: tierKey } = buildTestMessages(tool, input);
          const tier: ModelTier =
            (config.routing as Record<string, ModelTier>)[tierKey] ?? "smart";
          const model = tier === "smart" ? config.smartModel : config.fastModel;

          const start = Date.now();
          try {
            const result = await chatCompletion(config, tier, messages, tool);
            const latency = Date.now() - start;
            return json(res, { result, latency, model, tool, tokens: Math.ceil(result.length / 4) });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return json(res, { error: message, tool, model }, 500);
          }
        }

        return json(res, { error: "Not found" }, 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, { error: message }, 500);
      }
    }

    // Static files
    let filePath = url === "/" ? "/index.html" : url;
    // Prevent directory traversal
    filePath = filePath.replace(/\.\./g, "");
    const fullPath = join(staticDir, filePath);

    if (existsSync(fullPath)) {
      const ext = extname(fullPath);
      const mime = MIME_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(readFileSync(fullPath));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  server.listen(config.dashboardPort, () => {
    console.error(`Dashboard: http://localhost:${config.dashboardPort}`);
  });
}
