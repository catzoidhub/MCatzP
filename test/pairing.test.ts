// A client that starts while the pairing dialog is open: its first tools/list must not settle for mcatzp_status,
// because not every client reloads its tools after list_changed.
import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startFakecat } from '@catzoid/mcatzp-fakecat';
import { PROTOCOL_VERSION } from '@catzoid/mcatzp-protocol';
import { bridgeFileOf, describeState, discover } from '../packages/server/src/discovery.js';
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

test('a later list answers at once while the dialog is still open', async () => {
  const c = await connect(60_000, { MCATZP_PAIRING_WAIT_MS: '500' });
  await names(c);
  const t0 = Date.now();
  expect(await names(c)).toEqual(['mcatzp_status']);
  expect(Date.now() - t0).toBeLessThan(1_000);
}, 20_000);

test('one Allow pairs a client once, however many of its sessions are waiting', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcatzp-pairing-'));
  let allow = (_: boolean) => {};
  const asked = new Promise<boolean>((r) => (allow = r));
  let questions = 0;
  const paired: string[] = [];
  const cat = await startFakecat(dir, {
    pair: () => (questions++, asked),
    confirm: async () => 'once',
    isPaired: (n) => paired.includes(n),
    onPaired: (n) => paired.push(n),
  });
  clean.push(() => cat.stop(), () => rm(dir, { recursive: true, force: true }));
  const entry = cat.host.entry();
  const token = await readFile(entry.tokenFile!, 'utf8');
  const hello = (): Promise<string> =>
    new Promise((resolve) => {
      const s = net.connect(entry.channel!, () =>
        s.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hello', params: { protocol: PROTOCOL_VERSION, token, client: { name: 'many' }, server: { name: 'mcatzp', version: '0' } } })}\n`),
      );
      s.setEncoding('utf8');
      s.once('data', (d: string) => (s.destroy(), resolve(d)));
    });
  const sessions = [hello(), hello(), hello()];
  await new Promise((r) => setTimeout(r, 100));
  allow(true);
  for (const r of await Promise.all(sessions)) expect(JSON.parse(r).result.app.id).toBe('fakecat');
  expect(questions).toBe(1);
  expect(paired).toEqual(['many']);
});

test('a closed app is told apart from one with MCatzP off', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcatzp-closed-'));
  clean.push(() => rm(dir, { recursive: true, force: true }));
  const entry = { protocol: PROTOCOL_VERSION, enabled: false, app: { id: 'fakecat', name: 'Fakecat', version: '1.1.0' } };
  const file = path.join(dir, 'bridge.json');
  const env = { MCATZP_NO_DEFAULT_APPS: '1', MCATZP_BRIDGE_PATHS: file };
  const say = async () => describeState((await discover(env))[0]!);
  await writeFile(file, JSON.stringify({ mcatzp: { ...entry, closed: true } }));
  expect(await say()).toBe('Fakecat is closed: open it to use its tools. MCatzP stays on in it.');
  await writeFile(file, JSON.stringify({ mcatzp: entry }));
  expect(await say()).toContain('MCatzP is off in it');
});

test('Linux: a sandboxed XDG_CONFIG_HOME falls back to ~/.config, where the apps are', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mcatzp-xdg-'));
  clean.push(() => rm(home, { recursive: true, force: true }));
  {
    const sandbox = path.join(home, '.var', 'app', 'dev.zed.Zed', 'config');
    const env = { XDG_CONFIG_HOME: sandbox };
    expect(await bridgeFileOf('DoCatz', env, 'linux', home)).toBe(path.join(sandbox, 'DoCatz', 'bridge.json'));
    await mkdir(path.join(home, '.config', 'DoCatz'), { recursive: true });
    expect(await bridgeFileOf('DoCatz', env, 'linux', home)).toBe(path.join(home, '.config', 'DoCatz', 'bridge.json'));
    await mkdir(path.join(sandbox, 'DoCatz'), { recursive: true });
    expect(await bridgeFileOf('DoCatz', env, 'linux', home)).toBe(path.join(sandbox, 'DoCatz', 'bridge.json'));
  }
});
