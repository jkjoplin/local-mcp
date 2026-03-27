import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Config } from "./config.js";
import { LocalToolName, prepareToolCall, runToolInput } from "./tool-runner.js";

async function toolCall(
  config: Config,
  toolName: LocalToolName,
  input: string,
  options?: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await runToolInput(
      config,
      toolName,
      input,
      (options ?? {}) as never,
    );
    return { content: [{ type: "text" as const, text: result.result }] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
}

export function registerTools(server: McpServer, config: Config): void {
  // 1. ask_local
  server.tool(
    "ask_local",
    "Send a general-purpose prompt to a local LLM running on this machine. Use this for any question or task that doesn't fit a more specific tool. Fast and free — no API costs. Defaults to the smart (reasoning-capable) model.",
    {
      prompt: z.string().describe("The prompt to send to the local LLM"),
      model: z
        .enum(["fast", "smart"])
        .optional()
        .describe('Model tier override: "fast" or "smart" (default: "smart")'),
    },
    async ({ prompt, model }) => {
      return toolCall(config, "ask_local", prompt, { model });
    },
  );

  // 2. reason
  server.tool(
    "reason",
    "Deep step-by-step reasoning on a complex problem using a local LLM. Use this when you need careful analysis, multi-step logic, or thorough problem decomposition. Routes to the smart/reasoning model.",
    {
      prompt: z.string().describe("The reasoning task to send to the local LLM"),
    },
    async ({ prompt }) => {
      return toolCall(config, "reason", prompt);
    },
  );

  // 3. classify
  server.tool(
    "classify",
    "Classify text into one or more categories using a local LLM. Ultra-fast — runs on the fast model. Returns JSON with {result, confidence}. Use this for sentiment analysis, topic tagging, intent detection, content moderation, etc.",
    {
      text: z.string().describe("The text to classify"),
      categories: z.array(z.string()).describe("The list of possible categories"),
      multi: z.boolean().optional().describe("If true, allow multiple categories (default: false)"),
    },
    async ({ text, categories, multi }) => {
      return toolCall(config, "classify", text, { categories, multi });
    },
  );

  // 4. summarize
  server.tool(
    "summarize",
    "Summarize text using a local LLM. Supports bullet-point or paragraph format with optional word limit. Fast and free — use this for meeting notes, article summaries, changelog digests, etc.",
    {
      text: z.string().describe("The text to summarize"),
      format: z.enum(["bullet", "paragraph"]).optional().describe('Output format (default: "paragraph")'),
      max_words: z.number().optional().describe("Approximate maximum word count"),
    },
    async ({ text, format, max_words }) => {
      return toolCall(config, "summarize", text, { format, max_words });
    },
  );

  // 5. code_review
  server.tool(
    "code_review",
    "Review code for bugs, performance issues, and style problems using a local LLM. Returns specific, actionable feedback with severity levels. Use this for quick code audits without sending code to external APIs.",
    {
      code: z.string().describe("The code to review"),
      language: z.string().optional().describe("Programming language"),
      focus: z
        .enum(["bugs", "performance", "style", "all"])
        .optional()
        .describe('Review focus area (default: "all")'),
    },
    async ({ code, language, focus }) => {
      return toolCall(config, "code_review", code, { language, focus });
    },
  );

  // 6. explain
  server.tool(
    "explain",
    "Explain code or a technical concept using a local LLM. Supports beginner/intermediate/expert depth levels. Use this to get clear explanations without API costs — great for unfamiliar codebases or concepts.",
    {
      content: z.string().describe("The code or concept to explain"),
      level: z
        .enum(["beginner", "intermediate", "expert"])
        .optional()
        .describe('Explanation depth (default: "intermediate")'),
    },
    async ({ content, level }) => {
      return toolCall(config, "explain", content, { level });
    },
  );

  // 7. extract
  server.tool(
    "extract",
    "Extract structured data from unstructured text using a local LLM. Describe the desired JSON schema in plain English and get clean JSON back. Use for parsing logs, emails, resumes, invoices, etc.",
    {
      text: z.string().describe("The text to extract data from"),
      schema: z.string().describe("JSON schema description in plain English"),
    },
    async ({ text, schema }) => {
      return toolCall(config, "extract", text, { schema });
    },
  );

  // 8. translate
  server.tool(
    "translate",
    "Translate text to any target language using a local LLM. Optionally preserves original formatting. Fast and private — text never leaves your machine.",
    {
      text: z.string().describe("The text to translate"),
      target_language: z.string().describe("Target language (e.g. 'Spanish', 'Japanese')"),
      preserve_formatting: z.boolean().optional().describe("Preserve original formatting (default: true)"),
    },
    async ({ text, target_language, preserve_formatting }) => {
      return toolCall(config, "translate", text, {
        target_language,
        preserve_formatting,
      });
    },
  );

  // 9. diff_analysis
  server.tool(
    "diff_analysis",
    "Analyze a git diff using a local LLM. Returns JSON with {summary, risks, suggestions}. Use this for pre-commit review, PR analysis, or understanding unfamiliar changes. Routes to the smart model.",
    {
      diff: z.string().describe("The git diff to analyze"),
      context: z.string().optional().describe("Additional context about the change"),
    },
    async ({ diff, context }) => {
      return toolCall(config, "diff_analysis", diff, { context });
    },
  );
}
