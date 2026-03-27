import { Config } from "./config.js";

export type ModelTier = "fast" | "smart";

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
}

export async function chatCompletion(
  config: Config,
  tier: ModelTier,
  messages: ChatMessage[],
): Promise<string> {
  const baseUrl = tier === "smart" ? config.smartUrl : config.fastUrl;
  const model = tier === "smart" ? config.smartModel : config.fastModel;
  const url = `${baseUrl}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

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
    return content.trim();
  } catch (err: unknown) {
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
