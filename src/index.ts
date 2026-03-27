#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";
import { startDashboard } from "./dashboard-server.js";
import { runCli } from "./cli.js";

const config = loadConfig();
const invokedAs = process.argv[1]?.split("/").pop() ?? "local-mcp";
const aliasCommand =
  invokedAs === "local-mcp-fit"
    ? "fit"
    : invokedAs === "local-mcp-init"
      ? "init"
      : null;
const command = aliasCommand ?? process.argv[2] ?? "start";

// Try CLI commands first
const handled = await runCli(aliasCommand ? [aliasCommand] : process.argv.slice(2));
if (handled) {
  process.exit(0);
}

async function startMcp(): Promise<void> {
  const server = new McpServer({
    name: "local-mcp",
    version: "5.0.0",
  });
  registerTools(server, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

switch (command) {
  case "serve":
    await startMcp();
    break;
  case "dashboard":
    startDashboard(config);
    break;
  case "start":
  default:
    startDashboard(config);
    await startMcp();
    break;
}
