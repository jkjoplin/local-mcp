import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface RequestLog {
  timestamp: string;
  tool: string;
  model: string;
  tier: string;
  tokens: number;
  latencyMs: number;
  status: string;
}

export function logRequest(entry: RequestLog, logPath: string): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Silently fail — logging should never break the tool
  }
}

export function readLogs(logPath: string, limit = 100): RequestLog[] {
  try {
    if (!existsSync(logPath)) return [];
    const lines = readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l) as RequestLog);
    return entries.slice(-limit);
  } catch {
    return [];
  }
}

export function getStats(logPath: string): {
  totalRequests: number;
  totalTokens: number;
  estimatedCostSaved: number;
} {
  const logs = readLogs(logPath, 100000);
  const totalRequests = logs.length;
  const totalTokens = logs.reduce((sum, l) => sum + l.tokens, 0);
  // Assume $0.003 per 1k tokens (GPT-4 equivalent cost saved)
  const estimatedCostSaved = (totalTokens / 1000) * 0.003;
  return { totalRequests, totalTokens, estimatedCostSaved };
}
