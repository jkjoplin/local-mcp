# local-mcp

An MCP server that delegates tasks to local LLM servers running OpenAI-compatible APIs (such as MLX servers). It exposes four tools — `ask_local`, `reason`, `classify`, and `summarize` — that route requests to either a "smart" or "fast" local model, letting Claude Code (or any MCP-compatible agent) offload work to on-device LLMs.

## Setup

```bash
npm install
npm run build
```

## Configuration

All settings are via environment variables. Every variable has a sensible default.

| Variable | Default | Description |
|---|---|---|
| `LOCAL_MCP_SMART_URL` | `http://localhost:8081` | Base URL of the smart/reasoning model server |
| `LOCAL_MCP_FAST_URL` | `http://localhost:8083` | Base URL of the fast model server |
| `LOCAL_MCP_SMART_MODEL` | `mlx-community/Qwen3.5-9B-MLX-4bit` | Model name sent to the smart server |
| `LOCAL_MCP_FAST_MODEL` | `mlx-community/Qwen2.5-1.5B-Instruct-4bit` | Model name sent to the fast server |
| `LOCAL_MCP_TIMEOUT_MS` | `30000` | Request timeout in milliseconds |

Copy `.env.example` to `.env` and adjust as needed.

## Usage

### Claude Code

```bash
claude mcp add local-mcp -- node /absolute/path/to/local-mcp/dist/index.js
```

Or with environment variables:

```bash
claude mcp add local-mcp -e LOCAL_MCP_SMART_URL=http://localhost:8081 -e LOCAL_MCP_FAST_URL=http://localhost:8083 -- node /absolute/path/to/local-mcp/dist/index.js
```

### Generic MCP client config (JSON)

```json
{
  "mcpServers": {
    "local-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/local-mcp/dist/index.js"],
      "env": {
        "LOCAL_MCP_SMART_URL": "http://localhost:8081",
        "LOCAL_MCP_FAST_URL": "http://localhost:8083",
        "LOCAL_MCP_SMART_MODEL": "mlx-community/Qwen3.5-9B-MLX-4bit",
        "LOCAL_MCP_FAST_MODEL": "mlx-community/Qwen2.5-1.5B-Instruct-4bit"
      }
    }
  }
}
```

## Example .env configs

### Mac mini (M4, 16 GB) — smaller models, separate ports

```env
LOCAL_MCP_SMART_URL=http://localhost:8081
LOCAL_MCP_FAST_URL=http://localhost:8083
LOCAL_MCP_SMART_MODEL=mlx-community/Qwen3.5-9B-MLX-4bit
LOCAL_MCP_FAST_MODEL=mlx-community/Qwen2.5-1.5B-Instruct-4bit
LOCAL_MCP_TIMEOUT_MS=30000
```

### MacBook Pro (M4 Max, 64 GB) — larger models

```env
LOCAL_MCP_SMART_URL=http://localhost:8081
LOCAL_MCP_FAST_URL=http://localhost:8083
LOCAL_MCP_SMART_MODEL=mlx-community/Qwen3.5-27B-MLX-4bit
LOCAL_MCP_FAST_MODEL=mlx-community/Qwen2.5-7B-Instruct-4bit
LOCAL_MCP_TIMEOUT_MS=60000
```

## Model suggestions for MacBook Pro

With 64+ GB of unified memory, you can run much larger models:

- **Smart/Reasoning**: `mlx-community/Qwen3.5-27B-MLX-4bit` or `mlx-community/phi-4-reasoning-plus-4bit` — strong reasoning and general-purpose performance
- **Fast**: `mlx-community/Qwen2.5-7B-Instruct-4bit` — fast enough for classification and summarization while being more capable than the 1.5B variant

## Tools

- **ask_local** — General-purpose prompt, defaults to the smart model. Accepts an optional `model` parameter (`"fast"` or `"smart"`) to override.
- **reason** — Deep reasoning prompt, always uses the smart model with a step-by-step system prompt.
- **classify** — Classifies text into provided categories using the fast model. Returns JSON with `result` and `confidence`.
- **summarize** — Summarizes text using the fast model. Supports `"bullet"` or `"paragraph"` format and an optional word limit.
