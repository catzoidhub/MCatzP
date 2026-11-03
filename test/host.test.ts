// The channel's rules, talking to the host directly as a hostile local process would.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ErrorCodes, PROTOCOL_VERSION } from '@catzoid/mcatzp-protocol';
import { startFakecat } from '@catzoid/mcatzp-fakecat';

let dir: string;
let cat: Awaited<ReturnType<typeof startFakecat>>;
let allowPair = true;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mcatzp-host-'));
  cat = await startFakecat(dir, {
    pair: async () => allowPair,
    confirm: async () => 'once',
    inScope: (_a, args) => args.id !== 'feather',
    rateLimit: { perSecond: 1, burst: 3 },
  });
});
afterAll(async () => {
  await cat.stop();
  await rm(dir, { recursive: true, force: true });
});

async function session() {
  const s = net.connect(cat.host.entry().channel!);
  await new Promise((r) => s.once('connect', r));
  s.setEncoding('utf8');
  let buf = '';
  const waiting: ((v: any) => void)[] = [];
  s.on('data', (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      waiting.shift()?.(JSON.parse(line));
    }
  });
  let id = 0;
  const send = (method: string, params: unknown) =>
    new Promise<any>((r) => {
      waiting.push(r);
      s.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
    });
  return { send, close: () => s.destroy() };
}

const token = () => readFile(cat.host.entry().tokenFile!, 'utf8');
const hello = async (send: (m: string, p: unknown) => Promise<any>, name = 'test', t?: string) =>
  send('hello', { protocol: PROTOCOL_VERSION, token: t ?? (await token()), client: { name }, server: { name: 'mcatzp', version: '0' } });

test('nothing works before hello', async () => {
  const { send, close } = await session();
  expect((await send('actions.list', {})).error.code).toBe(ErrorCodes.unauthorized);
  close();
});

test('a wrong token is refused', async () => {
  const { send, close } = await session();
  expect((await hello(send, 'x', 'f'.repeat(64))).error.code).toBe(ErrorCodes.unauthorized);
  close();
});

test('a client the user does not approve is refused', async () => {
  allowPair = false;
  const { send, close } = await session();
  expect((await hello(send, 'stranger')).error.code).toBe(ErrorCodes.pairingDenied);
  allowPair = true;
  close();
});

test('another protocol version is told which one the app speaks', async () => {
  const { send, close } = await session();
  const r = await send('hello', { protocol: 99, token: await token(), client: { name: 'x' }, server: { name: 'mcatzp', version: '0' } });
  expect(r.error.code).toBe(ErrorCodes.protocolMismatch);
  close();
});

test('out of scope, unknown action, rate limit', async () => {
  const { send, close } = await session();
  expect((await hello(send)).result.app.id).toBe('fakecat');
  expect((await send('actions.call', { name: 'get_toy', args: { id: 'feather' } })).error.code).toBe(ErrorCodes.outOfScope);
  expect((await send('actions.call', { name: 'format_disk', args: {} })).error.code).toBe(ErrorCodes.unknownAction);
  expect((await send('actions.call', { name: 'get_toy', args: { id: 'mouse' } })).result.text).toContain('Felt mouse');
  // burst of 3 used up: the fourth call in a row is refused
  expect((await send('actions.call', { name: 'get_toy', args: { id: 'mouse' } })).error.code).toBe(ErrorCodes.rateLimited);
  close();
});

test('the token changes every time the switch goes on', async () => {
  const before = await token();
  await cat.host.stop();
  await cat.host.start();
  expect(await token()).not.toBe(before);
});
