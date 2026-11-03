#!/usr/bin/env node
// `mcatzp` — started by an MCP client over stdio. Nothing is printed to stdout but MCP messages.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcatzpServer } from './server.js';
import { VERSION } from './version.js';

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  console.log(VERSION);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  console.log(`MCatzP ${VERSION} — one MCP server for every Catzoid app.

Add it to your MCP client as a stdio server, for example:
  claude mcp add mcatzp -- npx -y mcatzp

Then turn MCatzP on in each app: Settings → AI → MCatzP.
https://catzoid.com/mcatzp`);
  process.exit(0);
}

const { server, close } = createMcatzpServer();
await server.connect(new StdioServerTransport());
const stop = () => {
  close();
  void server.close().finally(() => process.exit(0));
};
process.stdin.on('close', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
