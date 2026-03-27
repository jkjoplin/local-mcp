import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TaskType =
  | "ask"
  | "reason"
  | "classify"
  | "summarize"
  | "code_review"
  | "explain"
  | "extract"
  | "translate"
  | "diff_analysis";

export type ModelTier = "fast" | "smart";

export interface EndpointConfig {
  url: string;
  model: string;
}

export interface ConfigFile {
  endpoints: {
    smart: EndpointConfig;
    fast: EndpointConfig;
  };
  routing: Record<TaskType, ModelTier>;
  dashboard: { port: number };
  tracking: { enabled: boolean; log_path: string };
  templates?: Record<string, string>;
}

export interface Config {
  smartUrl: string;
  fastUrl: string;
  smartModel: string;
  fastModel: string;
  timeoutMs: number;
  routing: Record<TaskType, ModelTier>;
  dashboardPort: number;
  tracking: { enabled: boolean; logPath: string };
  configPath: string;
}

const CONFIG_DIR = join(homedir(), ".local-mcp");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG_FILE: ConfigFile = {
  endpoints: {
    smart: {
      url: "http://localhost:8081",
      model: "mlx-community/Qwen3.5-9B-MLX-4bit",
    },
    fast: {
      url: "http://localhost:8083",
      model: "mlx-community/Qwen2.5-1.5B-Instruct-4bit",
    },
  },
  routing: {
    ask: "smart",
    reason: "smart",
    classify: "fast",
    summarize: "fast",
    code_review: "smart",
    explain: "smart",
    extract: "fast",
    translate: "fast",
    diff_analysis: "smart",
  },
  dashboard: { port: 4242 },
  tracking: { enabled: true, log_path: "~/.local-mcp/requests.jsonl" },
};

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function loadConfigFile(): ConfigFile {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<ConfigFile>;
      return { ...DEFAULT_CONFIG_FILE, ...parsed };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_CONFIG_FILE };
}

export function saveConfigFile(cfg: ConfigFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

export function loadConfig(): Config {
  const file = loadConfigFile();

  const smartUrl =
    process.env.LOCAL_MCP_SMART_URL ?? file.endpoints.smart.url;
  const fastUrl =
    process.env.LOCAL_MCP_FAST_URL ?? file.endpoints.fast.url;
  const smartModel =
    process.env.LOCAL_MCP_SMART_MODEL ?? file.endpoints.smart.model;
  const fastModel =
    process.env.LOCAL_MCP_FAST_MODEL ?? file.endpoints.fast.model;

  return {
    smartUrl,
    fastUrl,
    smartModel,
    fastModel,
    timeoutMs: parseInt(process.env.LOCAL_MCP_TIMEOUT_MS ?? "30000", 10),
    routing: { ...DEFAULT_CONFIG_FILE.routing, ...file.routing },
    dashboardPort: file.dashboard?.port ?? 4242,
    tracking: {
      enabled: file.tracking?.enabled ?? true,
      logPath: expandHome(
        file.tracking?.log_path ?? "~/.local-mcp/requests.jsonl",
      ),
    },
    configPath: CONFIG_PATH,
  };
}

export function getConfigFile(): ConfigFile {
  return loadConfigFile();
}

export function updateConfigFile(updates: Partial<ConfigFile>): ConfigFile {
  const current = loadConfigFile();
  const merged: ConfigFile = {
    endpoints: updates.endpoints
      ? { ...current.endpoints, ...updates.endpoints }
      : current.endpoints,
    routing: updates.routing
      ? { ...current.routing, ...updates.routing }
      : current.routing,
    dashboard: updates.dashboard
      ? { ...current.dashboard, ...updates.dashboard }
      : current.dashboard,
    tracking: updates.tracking
      ? { ...current.tracking, ...updates.tracking }
      : current.tracking,
    templates: updates.templates
      ? { ...(current.templates ?? {}), ...updates.templates }
      : current.templates,
  };
  saveConfigFile(merged);
  return merged;
}
