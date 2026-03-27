# local-mcp

**Stop paying for GPT-4 to classify text.**

local-mcp is an MCP server that routes AI tasks to local LLMs running on your Mac. Classification, summarization, translation, code review — all running on Apple Silicon with zero API costs, zero latency to the cloud, and zero data leaving your machine.

It ships with a web dashboard for monitoring, a setup wizard for getting MLX models running, and 9 purpose-built tools that any MCP client (Claude Code, Codex, etc.) can call.

## Quick Start

```bash
# 1. Install and start an MLX model
pip install mlx-lm
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-9B-MLX-4bit --port 8081

# 2. Add to Claude Code
claude mcp add local-mcp -- npx local-mcp serve

# 3. Open the dashboard
npx local-mcp dashboard
# → http://localhost:4242
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Claude Code / Codex / MCP Client                   │
│  Calls tools: ask_local, classify, summarize, ...   │
└──────────────────────┬──────────────────────────────┘
                       │ MCP (stdio)
                       ▼
┌─────────────────────────────────────────────────────┐
│  local-mcp                                          │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  9 Tools  │  │  Router   │  │  Request Tracker │ │
│  └─────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
│        │             │                  │           │
│        ▼             ▼                  ▼           │
│  ┌──────────────────────┐  ┌────────────────────┐  │
│  │  OpenAI-compat API   │  │  Dashboard :4242   │  │
│  └──────┬───────┬───────┘  └────────────────────┘  │
│         │       │                                   │
└─────────┼───────┼───────────────────────────────────┘
          │       │
    ┌─────▼──┐ ┌──▼─────┐
    │ :8081  │ │ :8083  │
    │ Smart  │ │  Fast  │
    │ (9B+)  │ │ (1.5B) │
    └────────┘ └────────┘
     MLX LM     MLX LM
```

## Tools

### 1. `ask_local` — General prompt
Send any question to a local LLM. Defaults to the smart model.
```
Input:  { prompt: "What is the CAP theorem?", model?: "fast"|"smart" }
Output: "The CAP theorem states that a distributed system can only..."
```

### 2. `reason` — Deep reasoning
Step-by-step analysis for complex problems. Routes to the smart model.
```
Input:  { prompt: "Is this O(n log n) or O(n²)? <code>" }
Output: "Let me analyze step by step..."
```

### 3. `classify` — Fast classification
Classify text into categories. Returns JSON with result and confidence.
```
Input:  { text: "I love this product!", categories: ["positive","negative","neutral"] }
Output: { "result": "positive", "confidence": "high" }
```

### 4. `summarize` — Summarize text
Bullet or paragraph format with optional word limit.
```
Input:  { text: "<article>", format: "bullet", max_words: 100 }
Output: "- Key point one\n- Key point two\n- ..."
```

### 5. `code_review` — Code review
Review code for bugs, performance, and style issues.
```
Input:  { code: "function foo() {...}", language: "typescript", focus: "bugs" }
Output: "CRITICAL: Possible null dereference at line 12..."
```

### 6. `explain` — Explain code or concepts
Adjustable depth: beginner, intermediate, or expert.
```
Input:  { content: "async function* gen() {...}", level: "beginner" }
Output: "This is an async generator function. Think of it like..."
```

### 7. `extract` — Structured data extraction
Extract JSON from unstructured text using a plain-English schema.
```
Input:  { text: "John Smith, 42, john@example.com", schema: "name, age, email" }
Output: { "name": "John Smith", "age": 42, "email": "john@example.com" }
```

### 8. `translate` — Translation
Translate text to any language, optionally preserving formatting.
```
Input:  { text: "Hello world", target_language: "Japanese", preserve_formatting: true }
Output: "こんにちは世界"
```

### 9. `diff_analysis` — Git diff analysis
Analyze diffs for risks and suggestions. Returns structured JSON.
```
Input:  { diff: "<git diff output>", context: "Refactoring auth module" }
Output: { "summary": "...", "risks": ["..."], "suggestions": ["..."] }
```

## Dashboard

Open the dashboard at `http://localhost:4242` to get:

- **Status** — Live health of smart/fast endpoints with latency, total requests, tokens, and estimated cost savings
- **Model Library** — 7 recommended MLX models with RAM, speed, and one-click download commands
- **Task Routing** — Configure which model tier (fast/smart) handles each tool
- **Setup Wizard** — 6-step guided setup: prerequisites check, MLX install, model download, server launch, config, and Claude Code registration
- **Request Logs** — Last 100 requests with tool, model, tokens, latency, and status

## Configuration

Config lives at `~/.local-mcp/config.json`. Environment variables override file values.

| Setting | Env Var | Default | Description |
|---------|---------|---------|-------------|
| Smart endpoint URL | `LOCAL_MCP_SMART_URL` | `http://localhost:8081` | URL for the smart/reasoning model |
| Fast endpoint URL | `LOCAL_MCP_FAST_URL` | `http://localhost:8083` | URL for the fast/classification model |
| Smart model name | `LOCAL_MCP_SMART_MODEL` | `mlx-community/Qwen3.5-9B-MLX-4bit` | Model ID for smart tier |
| Fast model name | `LOCAL_MCP_FAST_MODEL` | `mlx-community/Qwen2.5-1.5B-Instruct-4bit` | Model ID for fast tier |
| Timeout | `LOCAL_MCP_TIMEOUT_MS` | `30000` | Request timeout in milliseconds |
| Dashboard port | — | `4242` | Web dashboard port |
| Request tracking | — | `true` | Log requests to JSONL |

Example `~/.local-mcp/config.json`:
```json
{
  "endpoints": {
    "smart": { "url": "http://localhost:8081", "model": "mlx-community/Qwen3.5-9B-MLX-4bit" },
    "fast": { "url": "http://localhost:8083", "model": "mlx-community/Qwen2.5-1.5B-Instruct-4bit" }
  },
  "routing": {
    "ask": "smart", "reason": "smart", "classify": "fast",
    "summarize": "fast", "code_review": "smart", "explain": "smart",
    "extract": "fast", "translate": "fast", "diff_analysis": "smart"
  },
  "dashboard": { "port": 4242 },
  "tracking": { "enabled": true, "log_path": "~/.local-mcp/requests.jsonl" }
}
```

## Model Recommendations

### Mac mini 24GB RAM
Run both tiers simultaneously:
- **Smart:** Qwen 3.5 9B (5.6 GB) — 52 t/s
- **Fast:** Qwen 2.5 1.5B (1 GB) — 215 t/s
- Headroom: ~17 GB for macOS + apps

### MacBook Pro 36GB RAM
Upgrade the smart tier:
- **Smart:** Qwen 3 14B (8.4 GB) — 29 t/s
- **Fast:** Qwen 2.5 7B (4.4 GB) — 60 t/s
- Or: Gemma 3 12B for vision tasks

### MacBook Pro 64GB+ RAM
Run the largest models:
- **Smart:** Qwen 3.5 27B (15.3 GB) — 16 t/s
- **Fast:** Qwen 3.5 9B (5.6 GB) — 52 t/s
- Or: Phi-4 Reasoning Plus for math-heavy work

## Always-On MLX Servers (LaunchAgent)

Create `~/Library/LaunchAgents/com.local-mcp.smart.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.local-mcp.smart</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>-m</string>
        <string>mlx_lm.server</string>
        <string>--model</string>
        <string>mlx-community/Qwen3.5-9B-MLX-4bit</string>
        <string>--port</string>
        <string>8081</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/local-mcp-smart.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/local-mcp-smart.log</string>
</dict>
</plist>
```

```bash
# Load it
launchctl load ~/Library/LaunchAgents/com.local-mcp.smart.plist

# Create a similar plist for the fast model on port 8083
```

## Adding to MCP Clients

### Claude Code
```bash
claude mcp add local-mcp -- npx local-mcp serve
```

### Claude Code (JSON config)
Add to `~/.claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "local-mcp": {
      "command": "npx",
      "args": ["local-mcp", "serve"]
    }
  }
}
```

### Codex / Any MCP Client
```json
{
  "mcpServers": {
    "local-mcp": {
      "command": "node",
      "args": ["/path/to/local-mcp/dist/index.js", "serve"]
    }
  }
}
```

## Subcommands

```bash
npx local-mcp serve      # MCP server only (stdio)
npx local-mcp dashboard  # Dashboard only (HTTP)
npx local-mcp start      # Both (default)
```

## Troubleshooting

**Server not responding**
- Check the MLX server is running: `curl http://localhost:8081/v1/models`
- Verify the port matches your config: `cat ~/.local-mcp/config.json`
- Check for port conflicts: `lsof -i :8081`

**Model too slow**
- Use a smaller quantization (4-bit models are fastest)
- Close other GPU-heavy apps (browsers with WebGL, video editors)
- Check Activity Monitor → GPU to see if another process is using the Neural Engine
- Upgrade to a model with higher t/s from the dashboard Model Library

**Dashboard not loading**
- Make sure you're running `npx local-mcp dashboard` or `npx local-mcp start`
- Default port is 4242: `http://localhost:4242`
- Check if the port is in use: `lsof -i :4242`

**"Cannot connect to smart/fast model"**
- Start an MLX server: `python3 -m mlx_lm.server --model <model-name> --port 8081`
- Use the Setup Wizard in the dashboard to walk through the full setup

**Request tracking not working**
- Check `~/.local-mcp/config.json` has `"tracking": { "enabled": true }`
- Verify write permissions on `~/.local-mcp/requests.jsonl`
