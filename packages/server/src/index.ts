#!/usr/bin/env node
// `mcatzp` — started by an MCP client over stdio. Nothing is printed to stdout but MCP messages.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcatzpServer } from './server.js';
import { VERSION } from './version.js';

/** The same as Uninstall MCatzP in an app's Settings, for someone with no Catzoid app at hand. */
async function uninstallHere(): Promise<void> {
  const { installPath, uninstall } = await import('@catzoid/mcatzp-host/setup');
  const o = { site: 'https://catzoid.com' };
  const self = installPath(o);
  let r: Awaited<ReturnType<typeof uninstall>>;
  try {
    r = await uninstall(o);
  } catch (e) {
    // Windows cannot delete the running .exe: this is that .exe, so it is deleted once this process has ended.
    if (process.platform !== 'win32' || process.execPath.toLowerCase() !== self.toLowerCase() || !(e as Error).message.includes('in use')) {
      console.error((e as Error).message);
      process.exit(1);
    }
    const { spawn } = await import('node:child_process');
    const { dirname } = await import('node:path');
    spawn('cmd.exe', ['/d', '/c', `ping -n 3 127.0.0.1 >nul & del /f /q "${self}" & rmdir "${dirname(self)}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    r = { removedFrom: [], failed: [], binary: 'removed', keptPath: null };
    console.log('MCatzP was taken out of your AI assistants.');
  }
  for (const id of r.removedFrom) console.log(`Removed from ${id}.`);
  for (const f of r.failed) console.error(`Could not remove it from ${f.id}: ${f.error}`);
  if (r.binary === 'removed') console.log(`Removed ${self}.`);
  if (r.binary === 'kept') console.log(`Kept ${r.keptPath}: remove it the way it was installed (brew uninstall mcatzp, npm uninstall -g mcatzp).`);
  if (r.binary === 'none' && !r.removedFrom.length) console.log('MCatzP is not installed by a Catzoid app here, and no AI assistant runs it.');
  console.log('Each app keeps its own MCatzP switch: turn it off in Settings → MCatzP.');
  if (r.failed.length) process.exit(1);
}

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  console.log(VERSION);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  console.log(`MCatzP ${VERSION} — one MCP server for every Catzoid app.

Add it to your MCP client as a stdio server, for example:
  claude mcp add mcatzp -- npx -y mcatzp

Then turn MCatzP on in each app: Settings → MCatzP.

  mcatzp uninstall   take MCatzP out of every AI assistant and remove the copy the apps installed

https://catzoid.com/mcatzp`);
  process.exit(0);
}

if (arg === 'uninstall') {
  await uninstallHere();
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
