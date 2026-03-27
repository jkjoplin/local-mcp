import { Config, ModelTier } from "./config.js";
import { logRequest } from "./tracking.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export type { ModelTier };

export async function chatCompletion(
  config: Config,
  tier: ModelTier,
  messages: ChatMessage[],
  toolName?: string,
): Promise<string> {
  const baseUrl = tier === "smart" ? config.smartUrl : config.fastUrl;
  const model = tier === "smart" ? config.smartModel : config.fastModel;
  const url = `${baseUrl}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `LLM server returned ${response.status}: ${body || response.statusText}`,
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new Error("No content in LLM response");
    }

    const latencyMs = Date.now() - startTime;
    const tokens = data.usage?.total_tokens ?? estimateTokens(messages, content);

    if (config.tracking.enabled) {
      logRequest({
        timestamp: new Date().toISOString(),
        tool: toolName ?? "unknown",
        model,
        tier,
        tokens,
        latencyMs,
        status: "ok",
      }, config.tracking.logPath);
    }

    return content.trim();
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    if (config.tracking.enabled) {
      logRequest({
        timestamp: new Date().toISOString(),
        tool: toolName ?? "unknown",
        model,
        tier,
        tokens: 0,
        latencyMs,
        status: "error",
      }, config.tracking.logPath);
    }

    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Request to ${tier} model timed out after ${config.timeoutMs}ms`,
      );
    }
    if (
      err instanceof TypeError &&
      (err.message.includes("fetch failed") ||
        err.message.includes("ECONNREFUSED"))
    ) {
      throw new Error(
        `Cannot connect to ${tier} model at ${baseUrl}. Is the LLM server running?`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function estimateTokens(messages: ChatMessage[], response: string): number {
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil((inputChars + response.length) / 4);
}
