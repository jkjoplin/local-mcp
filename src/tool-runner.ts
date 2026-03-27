import type { Config, TaskType } from "./config.js";
import type { ModelTier } from "./models.js";
import { chatCompletionDetailed } from "./models.js";

export type LocalToolName =
  | "ask_local"
  | "reason"
  | "classify"
  | "summarize"
  | "code_review"
  | "explain"
  | "extract"
  | "translate"
  | "diff_analysis";

export interface ToolRunOptions {
  categories?: string[];
  multi?: boolean;
  format?: "bullet" | "paragraph";
  max_words?: number;
  language?: string;
  focus?: "bugs" | "performance" | "style" | "all";
  level?: "beginner" | "intermediate" | "expert";
  schema?: string;
  target_language?: string;
  preserve_formatting?: boolean;
  context?: string;
  model?: ModelTier;
}

interface PreparedToolCall {
  tier: ModelTier;
  messages: Array<{ role: "system" | "user"; content: string }>;
  resultTransform?: (raw: string) => string;
}

export const VALID_TOOLS: LocalToolName[] = [
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

const TOOL_TO_TASK: Record<LocalToolName, TaskType> = {
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

function tierFor(config: Config, tool: LocalToolName, override?: ModelTier): ModelTier {
  return override ?? config.routing[TOOL_TO_TASK[tool]] ?? "smart";
}

function extractJson(raw: string): string | null {
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  return arrayMatch?.[0] ?? null;
}

function parseClassifyResult(raw: string): string {
  const candidate = extractJson(raw);
  if (!candidate) return raw.trim();
  try {
    const parsed = JSON.parse(candidate) as { result?: string | string[] };
    if (Array.isArray(parsed.result)) return parsed.result.join(", ");
    if (typeof parsed.result === "string") return parsed.result;
  } catch {
    return raw.trim();
  }
  return raw.trim();
}

function parseStructuredResult(raw: string): string {
  const candidate = extractJson(raw);
  if (!candidate) return raw.trim();
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return raw.trim();
  }
}

export function prepareToolCall(
  config: Config,
  tool: LocalToolName,
  input: string,
  options: ToolRunOptions = {},
): PreparedToolCall {
  switch (tool) {
    case "ask_local":
      return {
        tier: tierFor(config, tool, options.model),
        messages: [{ role: "user", content: input }],
      };
    case "reason":
      return {
        tier: tierFor(config, tool, options.model),
        messages: [
          {
            role: "system",
            content: "Think step by step. Be thorough and precise in your reasoning.",
          },
          { role: "user", content: input },
        ],
      };
    case "classify": {
      const categories = options.categories ?? ["bug", "feature", "question", "other"];
      const multi = options.multi ?? false;
      const systemPrompt = multi
        ? `Classify the following text into one or more of these categories: ${categories.join(", ")}.\nRespond with ONLY a JSON object: {"result": ["cat1", "cat2"], "confidence": "high|medium|low"}`
        : `Classify the following text into exactly one of these categories: ${categories.join(", ")}.\nRespond with ONLY a JSON object: {"result": "category", "confidence": "high|medium|low"}`;
      return {
        tier: tierFor(config, tool, options.model),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input },
        ],
        resultTransform: parseClassifyResult,
      };
    }
    case "summarize": {
      const format = options.format ?? "paragraph";
      let systemPrompt = `Summarize the following text in ${format === "bullet" ? "bullet points" : "a concise paragraph"}.`;
      if (options.max_words) {
        systemPrompt += ` Keep it under ${options.max_words} words.`;
      }
      systemPrompt += " Respond with only the summary, no preamble.";
      return {
        tier: tierFor(config, tool, options.model),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input },
        ],
      };
    }
    case "code_review": {
      const focus = options.focus ?? "all";
      const language = options.language ? ` (${options.language})` : "";
      return {
        tier: tierFor(config, tool, options.model),
        messages: [
          {
            role: "system",
            content: `You are an expert code reviewer. Review the following${language} code focusing on ${focus === "all" ? "bugs, performance, and style" : focus}. Provide specific, actionable feedback. Format: list issues with severity (critical/warning/info), line reference if possible, and suggested fix.`,
          },
          { role: "user", content: input },
        ],
      };
    }
    case "explain":
      return {
        tier: tierFor(config, tool, options.model),
        messages: [
          {
            role: "system",
            content: `Explain the following clearly for a ${(options.level ?? "intermediate")}-level audience. Be concise but thorough. Use examples where helpful.`,
          },
          { role: "user", content: input },
        ],
      };
    case "extract":
      return {
        tier: tierFor(config, tool, options.model),
        messages: [
          {
            role: "system",
            content: `Extract structured data from the following text. Output ONLY valid JSON matching this schema: ${options.schema ?? "key facts with named fields relevant to the input"}. No other text.`,
          },
          { role: "user", content: input },
        ],
        resultTransform: parseStructuredResult,
      };
    case "translate":
      return {
        tier: tierFor(config, tool, options.model),
        messages: [
          {
            role: "system",
            content: `Translate the following text to ${options.target_language ?? "Spanish"}.${(options.preserve_formatting ?? true) ? " Preserve the original formatting, line breaks, and structure." : ""} Output only the translation, no preamble.`,
          },
          { role: "user", content: input },
        ],
      };
    case "diff_analysis": {
      const context = options.context ? `\nContext: ${options.context}` : "";
      return {
        tier: tierFor(config, tool, options.model),
        messages: [
          {
            role: "system",
            content: `Analyze the following git diff.${context} Respond with ONLY a JSON object: {"summary": "brief summary of changes", "risks": ["list of potential risks"], "suggestions": ["list of improvement suggestions"]}`,
          },
          { role: "user", content: input },
        ],
        resultTransform: parseStructuredResult,
      };
    }
  }
}

export async function runToolInput(
  config: Config,
  tool: LocalToolName,
  input: string,
  options: ToolRunOptions = {},
): Promise<{
  result: string;
  tokens: number;
  model: string;
  tier: ModelTier;
}> {
  const prepared = prepareToolCall(config, tool, input, options);
  const completion = await chatCompletionDetailed(
    config,
    prepared.tier,
    prepared.messages,
    tool,
  );

  return {
    result: prepared.resultTransform
      ? prepared.resultTransform(completion.content)
      : completion.content.trim(),
    tokens: completion.tokens,
    model: completion.model,
    tier: prepared.tier,
  };
}
