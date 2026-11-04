// MCatzP end to end: a real MCP client starts the server over stdio, the server finds fakecat through its
// bridge.json, pairs, lists the tools and calls each tier.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ConfirmAnswer, LogEntry } from '@catzoid/mcatzp-host';
import { startFakecat } from '@catzoid/mcatzp-fakecat';

let dir: string;
let cat: Awaited<ReturnType<typeof startFakecat>>;
let client: Client;
let answer: ConfirmAnswer = 'once';
const asked: string[] = [];
const paired: string[] = [];
const log: LogEntry[] = [];

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mcatzp-e2e-'));
  cat = await startFakecat(dir, {
    pair: async (c) => (paired.push(c.name), true),
    confirm: async (r) => (asked.push(`${r.action.tier}:${r.summary}`), answer),
    log: (e) => log.push(e),
  });
  client = new Client({ name: 'mcatzp-e2e', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      // MCATZP_E2E_CMD runs another build of the server, e.g. "node packages/server/dist/index.js" or the binary
      command: (process.env.MCATZP_E2E_CMD ?? `bun ${path.resolve('packages/server/src/index.ts')}`).split(' ')[0]!,
      args: (process.env.MCATZP_E2E_CMD ?? `bun ${path.resolve('packages/server/src/index.ts')}`).split(' ').slice(1),
      env: { ...(process.env as Record<string, string>), MCATZP_NO_DEFAULT_APPS: '1', MCATZP_BRIDGE_PATHS: cat.bridgeFile },
    }),
  );
});

afterAll(async () => {
  await client?.close();
  await cat?.stop();
  await rm(dir, { recursive: true, force: true });
});

describe('MCatzP with fakecat', () => {
  test('the server gives its name and icon', () => {
    const info = client.getServerVersion();
    expect(info?.title).toBe('MCatzP');
    expect(info?.icons?.[0]?.src).toStartWith('data:image/png;base64,');
  });

  test.skipIf(process.platform === 'win32')('the socket and token are owner-only', async () => {
    const entry = cat.host.entry();
    expect(((await stat(entry.channel!)).mode & 0o777).toString(8)).toBe('600');
    expect(((await stat(entry.tokenFile!)).mode & 0o777).toString(8)).toBe('600');
  });

  test('lists fakecat tools with their tiers, after pairing the client by name', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['mcatzp_status', 'fakecat_list_toys', 'fakecat_wash_toys', 'fakecat_get_toy', 'fakecat_rename_toy', 'fakecat_delete_toy']);
    expect(paired).toEqual(['mcatzp-e2e']);
    const del = tools.find((t) => t.name === 'fakecat_delete_toy')!;
    expect(del.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'fakecat_list_toys')!.annotations?.readOnlyHint).toBe(true);
  });

  test('read runs without a dialog', async () => {
    const r = await client.callTool({ name: 'fakecat_list_toys', arguments: {} });
    expect(text(r)).toContain('Felt mouse');
    expect(asked).toEqual([]);
  });

  test('a change asks in the app, built from the real arguments', async () => {
    const r = await client.callTool({ name: 'fakecat_rename_toy', arguments: { id: 'ball', name: 'Jingle' } });
    expect(text(r)).toBe('Renamed Bell ball to Jingle.');
    expect(asked.at(-1)).toBe('change:Rename "Bell ball" to "Jingle"');
  });

  test('declined in the app → an error result, nothing changes', async () => {
    answer = 'deny';
    const r = await client.callTool({ name: 'fakecat_delete_toy', arguments: { id: 'mouse' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('declined');
    expect(cat.toys.some((t) => t.id === 'mouse')).toBe(true);
  });

  test('"allow for this session" skips the next dialog for that change only', async () => {
    answer = 'session';
    await client.callTool({ name: 'fakecat_rename_toy', arguments: { id: 'ball', name: 'A' } });
    const n = asked.length;
    await client.callTool({ name: 'fakecat_rename_toy', arguments: { id: 'ball', name: 'B' } });
    expect(asked.length).toBe(n);
    await client.callTool({ name: 'fakecat_delete_toy', arguments: { id: 'feather' } });
    expect(asked.length).toBe(n + 1); // destructive always asks
    answer = 'once';
  });

  test('invalid arguments are refused by the schema', async () => {
    const r = await client.callTool({ name: 'fakecat_rename_toy', arguments: { id: 'ball', name: '', extra: 1 } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Invalid arguments');
  });

  test('mcatzp_status explains each cat', async () => {
    const r = await client.callTool({ name: 'mcatzp_status', arguments: {} });
    expect(text(r)).toContain('Fakecat has MCatzP on.');
  });

  test('every call is in the activity log', () => {
    expect(log.some((e) => e.action === 'delete_toy' && e.outcome === 'declined')).toBe(true);
    expect(log.some((e) => e.action === 'list_toys' && e.outcome === 'ok' && e.client === 'mcatzp-e2e')).toBe(true);
  });

  test('switching MCatzP off in the app removes its tools', async () => {
    await cat.stop();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['mcatzp_status']);
    const r = await client.callTool({ name: 'mcatzp_status', arguments: {} });
    expect(text(r)).toContain('MCatzP is off');
  });
});
