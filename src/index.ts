#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";
import { startDashboard } from "./dashboard-server.js";

const config = loadConfig();
const command = process.argv[2] ?? "start";

async function startMcp(): Promise<void> {
  const server = new McpServer({
    name: "local-mcp",
    version: "2.0.0",
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
