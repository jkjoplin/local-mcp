# local-mcp

**Run MCP tools against local MLX models on your Mac.**

`local-mcp` routes MCP tool calls, CLI prompts, and dashboard testing traffic to your own OpenAI-compatible local model servers. v5 adds better hardware detection, a one-command `init` flow, CLI streaming, and improved routing visibility in the dashboard.

## Quick Start

```bash
# 1. Install dependencies
pip install mlx-lm

# 2. Detect your hardware and write a starter config
npx local-mcp init

# 3. Start the two recommended MLX servers printed by init
python3 -m mlx_lm.server --model mlx-community/Qwen3.5-9B-MLX-4bit --port 8081
python3 -m mlx_lm.server --model mlx-community/Qwen2.5-1.5B-Instruct-4bit --port 8083

# 4. Register with Claude Code
claude mcp add local-mcp -- npx local-mcp serve

# 5. Open the dashboard
npx local-mcp dashboard
```

You can inspect hardware fit without writing config:

```bash
npx local-mcp fit
```

You can also ask the local model directly from the terminal. Output streams as tokens arrive:

```bash
npx local-mcp ask "Explain why mmap helps large-model inference"
```

## Architecture

```text
                    ┌──────────────────────────────┐
                    │      Hardware Scanner        │
                    │   local-mcp fit / init       │
                    └──────────────┬───────────────┘
                                   │ fit report
                                   ▼
┌───────────────┐   HTTP    ┌──────────────────────┐   HTTP    ┌───────────────┐
│ local-mcp CLI │──────────▶│  OpenAI-compatible   │──────────▶│  MLX Models   │
│ ask / fit /   │           │   local endpoints    │           │ smart + fast  │
│ init          │           └──────────────────────┘           └───────────────┘
└───────────────┘
        │
        │ stdio
        ▼
┌───────────────┐            HTTP                   ┌───────────────┐
│  MCP Server   │─────────────────────────────────▶│  MLX Models   │
│ Claude/Codex  │                                  │ smart + fast  │
└───────────────┘                                  └───────────────┘

┌───────────────┐   HTTP    ┌──────────────────────┐
│  Dashboard    │──────────▶│  OpenAI-compatible   │
│ status/routing│           │   local endpoints    │
└───────────────┘           └──────────────────────┘
```

## CLI

```bash
npx local-mcp ask "your question"
npx local-mcp ask --fast "classify this quickly"
npx local-mcp ask --reason "work through this carefully"
npx local-mcp fit
npx local-mcp init
npx local-mcp bench
npx local-mcp status
npx local-mcp dashboard
npx local-mcp serve
npx local-mcp start
```

Bin aliases:

```bash
local-mcp-fit
local-mcp-init
```

## Hardware Fit

`local-mcp fit` scores curated models against detected machine RAM.

- `perfect`: model RAM footprint is under 50% of system RAM
- `good`: under 70%
- `marginal`: under 85%
- `too_large`: likely poor experience or unsafe to run alongside normal apps

On macOS, v5 also improves CPU detection and available-memory reporting:

- CPU uses `system_profiler`, `sysctl -n machdep.cpu.brand_string`, and `sysctl -n hw.model`
- Apple Silicon detection checks both `sysctl -n hw.optional.arm64` and `uname -m`
- Available RAM uses `vm_stat` free + inactive + speculative pages instead of raw free pages only

## Machine Recommendations

| Machine | Smart | Fast |
|---|---|---|
| Mac mini 24GB | `Qwen3.5-9B` | `Qwen2.5-1.5B` |
| MacBook Pro 36GB | `Qwen3-14B` or `Phi-4` | `Qwen2.5-1.5B` |
| MacBook Pro 64GB | `Qwen3.5-27B` | `Qwen2.5-7B` |

## Dashboard

The dashboard at `http://localhost:4242` includes:

- Status with live smart/fast endpoint health and latency
- Model library with curated MLX models
- Hardware fit view with recommended smart/fast assignments
- Routing controls with health badges, reset-to-defaults, and last-saved timestamp
- Setup wizard, logs, and prompt template editing

## Configuration

`local-mcp init` writes `~/.local-mcp/config.json` with recommended models. Environment variables can still override the config file.

Example:

```json
{
  "endpoints": {
    "smart": {
      "url": "http://localhost:8081",
      "model": "mlx-community/Qwen3.5-9B-MLX-4bit"
    },
    "fast": {
      "url": "http://localhost:8083",
      "model": "mlx-community/Qwen2.5-1.5B-Instruct-4bit"
    }
  },
  "routing": {
    "ask": "smart",
    "reason": "smart",
    "classify": "fast",
    "summarize": "fast",
    "code_review": "smart",
    "explain": "smart",
    "extract": "fast",
    "translate": "fast",
    "diff_analysis": "smart"
  }
}
```

## MCP Clients

Claude Code:

```bash
claude mcp add local-mcp -- npx local-mcp serve
```

Generic stdio config:

```json
{
  "mcpServers": {
    "local-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/local-mcp/dist/index.js", "serve"]
    }
  }
}
```

## Troubleshooting

- If `ask` does not stream, `local-mcp` falls back to normal non-streaming JSON responses automatically.
- If `fit` reports `Unknown CPU`, make sure `sysctl`, `uname`, and `system_profiler` are available in your shell.
- If an endpoint is down, open the dashboard Routing tab to confirm which tier assignments currently point at an unhealthy server.
