import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Config } from "./config.js";
import { chatCompletion, ModelTier } from "./models.js";

export function registerTools(server: McpServer, config: Config): void {
  // --- ask_local ---
  server.tool(
    "ask_local",
    "General-purpose prompt routed to a local LLM. Defaults to the smart model.",
    {
      prompt: z.string().describe("The prompt to send to the local LLM"),
      model: z
        .enum(["fast", "smart"])
        .optional()
        .describe('Model tier override: "fast" or "smart" (default: "smart")'),
    },
    async ({ prompt, model }) => {
      const tier: ModelTier = model ?? "smart";
      try {
        const text = await chatCompletion(config, tier, [
          { role: "user", content: prompt },
        ]);
        return { content: [{ type: "text" as const, text }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // --- reason ---
  server.tool(
    "reason",
    "Deep reasoning prompt. Always uses the smart/reasoning model.",
    {
      prompt: z
        .string()
        .describe("The reasoning task to send to the local LLM"),
    },
    async ({ prompt }) => {
      try {
        const text = await chatCompletion(config, "smart", [
          {
            role: "system",
            content:
              "Think step by step. Be thorough and precise in your reasoning.",
          },
          { role: "user", content: prompt },
        ]);
        return { content: [{ type: "text" as const, text }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // --- classify ---
  server.tool(
    "classify",
    "Fast classification of text into provided categories. Uses the fast model.",
    {
      text: z.string().describe("The text to classify"),
      categories: z
        .array(z.string())
        .describe("The list of possible categories"),
      multi: z
        .boolean()
        .optional()
        .describe(
          "If true, allow multiple categories to be returned (default: false)",
        ),
    },
    async ({ text, categories, multi }) => {
      const multiLabel = multi ?? false;
      const systemPrompt = multiLabel
        ? `Classify the following text into one or more of these categories: ${categories.join(", ")}.\nRespond with ONLY a JSON object in this exact format: {"result": ["category1", "category2"], "confidence": "high|medium|low"}\nNo other text.`
        : `Classify the following text into exactly one of these categories: ${categories.join(", ")}.\nRespond with ONLY a JSON object in this exact format: {"result": "category", "confidence": "high|medium|low"}\nNo other text.`;

      try {
        const raw = await chatCompletion(config, "fast", [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ]);

        // Try to parse JSON from the response
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            result: string | string[];
            confidence?: string;
          };
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(parsed, null, 2) },
            ],
          };
        }

        // Fallback: return raw text wrapped in expected shape
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ result: raw.trim() }),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // --- summarize ---
  server.tool(
    "summarize",
    "Summarize text using the fast model.",
    {
      text: z.string().describe("The text to summarize"),
      format: z
        .enum(["bullet", "paragraph"])
        .optional()
        .describe('Output format: "bullet" or "paragraph" (default: "paragraph")'),
      max_words: z
        .number()
        .optional()
        .describe("Approximate maximum word count for the summary"),
    },
    async ({ text, format, max_words }) => {
      const fmt = format ?? "paragraph";
      let systemPrompt = `Summarize the following text in ${fmt === "bullet" ? "bullet points" : "a concise paragraph"}.`;
      if (max_words) {
        systemPrompt += ` Keep it under ${max_words} words.`;
      }
      systemPrompt += " Respond with only the summary, no preamble.";

      try {
        const summary = await chatCompletion(config, "fast", [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ]);
        return { content: [{ type: "text" as const, text: summary }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
