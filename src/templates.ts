import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TemplateMap {
  [key: string]: string;
}

export const DEFAULT_TEMPLATES: TemplateMap = {
  code_review:
    "Review this {language} code for {focus}. Be concise and specific:\n\n{code}",
  explain:
    "Explain the following to a {level}. Use clear language:\n\n{content}",
  classify:
    "Classify this text into one of: {categories}. Respond with ONLY the category name.\n\nText: {text}",
  summarize:
    "Summarize in {format} format{max_words_hint}:\n\n{text}",
  diff_analysis:
    "Analyze this git diff{context_hint}. Return JSON with: summary, risks[], suggestions[].\n\n{diff}",
  extract:
    "Extract data matching this schema: {schema}\n\nReturn ONLY valid JSON.\n\nText: {text}",
};

const CONFIG_PATH = join(homedir(), ".local-mcp", "config.json");

export function loadTemplates(): TemplateMap {
  const templates = { ...DEFAULT_TEMPLATES };
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as { templates?: TemplateMap };
      if (parsed.templates) {
        Object.assign(templates, parsed.templates);
      }
    }
  } catch {
    // Fall through to defaults
  }
  return templates;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return vars[key] ?? match;
  });
}
