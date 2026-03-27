export interface Config {
  smartUrl: string;
  fastUrl: string;
  smartModel: string;
  fastModel: string;
  timeoutMs: number;
}

export function loadConfig(): Config {
  return {
    smartUrl: process.env.LOCAL_MCP_SMART_URL ?? "http://localhost:8081",
    fastUrl: process.env.LOCAL_MCP_FAST_URL ?? "http://localhost:8083",
    smartModel:
      process.env.LOCAL_MCP_SMART_MODEL ??
      "mlx-community/Qwen3.5-9B-MLX-4bit",
    fastModel:
      process.env.LOCAL_MCP_FAST_MODEL ??
      "mlx-community/Qwen2.5-1.5B-Instruct-4bit",
    timeoutMs: parseInt(process.env.LOCAL_MCP_TIMEOUT_MS ?? "30000", 10),
  };
}
