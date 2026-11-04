// A client that starts while the pairing dialog is open: its first tools/list must not settle for mcatzp_status,
// because not every client reloads its tools after list_changed.
import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startFakecat } from '@catzoid/mcatzp-fakecat';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const f of clean.splice(0)) await f();
});

async function connect(pairMs: number, env: Record<string, string> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcatzp-pairing-'));
  const cat = await startFakecat(dir, { pair: () => new Promise((r) => setTimeout(() => r(true), pairMs)), confirm: async () => 'once', log: () => {} });
  const client = new Client({ name: 'late-client', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: 'bun',
      args: [path.resolve('packages/server/src/index.ts')],
      env: { ...(process.env as Record<string, string>), MCATZP_NO_DEFAULT_APPS: '1', MCATZP_BRIDGE_PATHS: cat.bridgeFile, ...env },
    }),
  );
  clean.push(() => client.close(), () => cat.stop(), () => rm(dir, { recursive: true, force: true }));
  return client;
}
const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name);

test('the first list waits for an answer that takes longer than the old 5 s', async () => {
  const c = await connect(7_000);
  const tools = await names(c);
  expect(tools.length).toBeGreaterThan(1);
}, 20_000);

test('a dialog left open costs one wait, then the status says what to do', async () => {
  const c = await connect(60_000, { MCATZP_PAIRING_WAIT_MS: '1000' });
  const t0 = Date.now();
  expect(await names(c)).toEqual(['mcatzp_status']);
  expect(Date.now() - t0).toBeLessThan(4_000);
  const r = (await c.callTool({ name: 'mcatzp_status', arguments: {} })) as { content: { text: string }[] };
  expect(r.content[0]?.text).toContain('start a new session');
}, 20_000);
