import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Config, getConfigFile, updateConfigFile, ConfigFile } from "./config.js";
import { readLogs, getStats } from "./tracking.js";
import { loadTemplates, DEFAULT_TEMPLATES } from "./templates.js";
import { CURATED_MODELS, detectHardware } from "./hardware.js";
import { runToolInput, VALID_TOOLS, LocalToolName } from "./tool-runner.js";

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

function getServerEntryPath(): string {
  const builtPath = join(__dirname, "index.js");
  if (existsSync(builtPath)) {
    return builtPath;
  }
  return join(__dirname, "..", "dist", "index.js");
}

function getMcpConfigs(): Record<string, unknown> {
  const serverPath = getServerEntryPath();
  return {
    claude: {
      mcpServers: {
        "local-mcp": {
          command: "node",
          args: [serverPath, "serve"],
        },
      },
    },
    codex: {
      mcpServers: {
        "local-mcp": {
          type: "stdio",
          command: "node",
          args: [serverPath, "serve"],
        },
      },
    },
    cursor: {
      mcpServers: {
        "local-mcp": {
          command: "node",
          args: [serverPath, "serve"],
          disabled: false,
        },
      },
    },
    generic: {
      name: "local-mcp",
      transport: "stdio",
      command: "node",
      args: [serverPath, "serve"],
      description: "Local LLM MCP server — route AI tasks to your own hardware",
    },
  };
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
          return json(res, CURATED_MODELS);
        }

        if (url === "/api/stats" && method === "GET") {
          return json(res, getStats(config.tracking.logPath));
        }

        if (url === "/api/hardware" && method === "GET") {
          return json(res, detectHardware());
        }

        if (url === "/api/mcp-config" && method === "GET") {
          return json(res, getMcpConfigs());
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
          const {
            tool,
            input,
            options = {},
          } = JSON.parse(body) as {
            tool: LocalToolName;
            input: string;
            options?: Record<string, unknown>;
          };

          if (!VALID_TOOLS.includes(tool)) {
            return json(res, { error: `Invalid tool: ${tool}` }, 400);
          }
          if (!input || !input.trim()) {
            return json(res, { error: "Input is required" }, 400);
          }

          try {
            const start = Date.now();
            const result = await runToolInput(config, tool, input, options);
            return json(res, {
              result: result.result,
              latencyMs: Date.now() - start,
              tokens: result.tokens,
              model: result.model,
              tool,
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return json(res, { error: message, tool }, 500);
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
