import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Config, ModelTier } from "./config.js";
import { chatCompletion } from "./models.js";

function tierFor(config: Config, task: string): ModelTier {
  return (config.routing as Record<string, ModelTier>)[task] ?? "smart";
}

async function toolCall(
  config: Config,
  tier: ModelTier,
  messages: Array<{ role: "system" | "user"; content: string }>,
  toolName: string,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const text = await chatCompletion(config, tier, messages, toolName);
    return { content: [{ type: "text" as const, text }] };
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
      const tier: ModelTier = model ?? tierFor(config, "ask");
      return toolCall(config, tier, [{ role: "user", content: prompt }], "ask_local");
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
      return toolCall(
        config,
        tierFor(config, "reason"),
        [
          { role: "system", content: "Think step by step. Be thorough and precise in your reasoning." },
          { role: "user", content: prompt },
        ],
        "reason",
      );
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
      const multiLabel = multi ?? false;
      const systemPrompt = multiLabel
        ? `Classify the following text into one or more of these categories: ${categories.join(", ")}.\nRespond with ONLY a JSON object: {"result": ["cat1", "cat2"], "confidence": "high|medium|low"}`
        : `Classify the following text into exactly one of these categories: ${categories.join(", ")}.\nRespond with ONLY a JSON object: {"result": "category", "confidence": "high|medium|low"}`;

      try {
        const raw = await chatCompletion(
          config,
          tierFor(config, "classify"),
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
          "classify",
        );
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { result: string | string[]; confidence?: string };
          return { content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ result: raw.trim() }) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
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
      const fmt = format ?? "paragraph";
      let sys = `Summarize the following text in ${fmt === "bullet" ? "bullet points" : "a concise paragraph"}.`;
      if (max_words) sys += ` Keep it under ${max_words} words.`;
      sys += " Respond with only the summary, no preamble.";
      return toolCall(
        config,
        tierFor(config, "summarize"),
        [{ role: "system", content: sys }, { role: "user", content: text }],
        "summarize",
      );
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
      const f = focus ?? "all";
      const lang = language ? ` (${language})` : "";
      const sys = `You are an expert code reviewer. Review the following${lang} code focusing on ${f === "all" ? "bugs, performance, and style" : f}. Provide specific, actionable feedback. Format: list issues with severity (critical/warning/info), line reference if possible, and suggested fix.`;
      return toolCall(
        config,
        tierFor(config, "code_review"),
        [{ role: "system", content: sys }, { role: "user", content: code }],
        "code_review",
      );
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
      const l = level ?? "intermediate";
      const sys = `Explain the following clearly for a ${l}-level audience. Be concise but thorough. Use examples where helpful.`;
      return toolCall(
        config,
        tierFor(config, "explain"),
        [{ role: "system", content: sys }, { role: "user", content: content }],
        "explain",
      );
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
      const sys = `Extract structured data from the following text. Output ONLY valid JSON matching this schema: ${schema}. No other text.`;
      try {
        const raw = await chatCompletion(
          config,
          tierFor(config, "extract"),
          [
            { role: "system", content: sys },
            { role: "user", content: text },
          ],
          "extract",
        );
        const jsonMatch = raw.match(/[\[{][\s\S]*[\]}]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return { content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }] };
        }
        return { content: [{ type: "text" as const, text: raw }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
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
      const pf = preserve_formatting ?? true;
      const sys = `Translate the following text to ${target_language}.${pf ? " Preserve the original formatting, line breaks, and structure." : ""} Output only the translation, no preamble.`;
      return toolCall(
        config,
        tierFor(config, "translate"),
        [{ role: "system", content: sys }, { role: "user", content: text }],
        "translate",
      );
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
      const ctx = context ? `\nContext: ${context}` : "";
      const sys = `Analyze the following git diff.${ctx} Respond with ONLY a JSON object: {"summary": "brief summary of changes", "risks": ["list of potential risks"], "suggestions": ["list of improvement suggestions"]}`;
      try {
        const raw = await chatCompletion(
          config,
          tierFor(config, "diff_analysis"),
          [
            { role: "system", content: sys },
            { role: "user", content: diff },
          ],
          "diff_analysis",
        );
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return { content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }] };
        }
        return { content: [{ type: "text" as const, text: raw }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
