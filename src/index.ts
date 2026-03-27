#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";

const config = loadConfig();

const server = new McpServer({
  name: "local-mcp",
  version: "1.0.0",
});

registerTools(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);
