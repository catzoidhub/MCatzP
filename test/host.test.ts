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

test('progress goes out only for a call that asked for it', async () => {
  const s = net.connect(cat.host.entry().channel!);
  await new Promise((r) => s.once('connect', r));
  s.setEncoding('utf8');
  const lines: any[] = [];
  let buf = '';
  s.on('data', (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const done = async (id: number) => {
    while (!lines.some((l) => l.id === id)) await new Promise((r) => setTimeout(r, 5));
  };
  const write = (m: unknown) => s.write(JSON.stringify(m) + '\n');
  write({ jsonrpc: '2.0', id: 1, method: 'hello', params: { protocol: PROTOCOL_VERSION, token: await token(), client: { name: 'progress-test' }, server: { name: 'test', version: '0' } } });
  await done(1);
  await new Promise((r) => setTimeout(r, 1100));
  write({ jsonrpc: '2.0', id: 2, method: 'actions.call', params: { name: 'wash_toys', args: {} } });
  await done(2);
  expect(lines.filter((l) => l.method === 'actions.progress').length).toBe(0);
  await new Promise((r) => setTimeout(r, 1100));
  write({ jsonrpc: '2.0', id: 3, method: 'actions.call', params: { name: 'wash_toys', args: {}, progressId: 3 } });
  await done(3);
  const got = lines.filter((l) => l.method === 'actions.progress').map((l) => l.params);
  expect(got.map((g) => g.percent)).toEqual([25, 50, 75]);
  expect(got.every((g) => g.progressId === 3)).toBe(true);
  s.destroy();
});

test('a client giving up closes the question, and nothing runs', async () => {
  const dir2 = await mkdtemp(path.join(os.tmpdir(), 'mcatzp-cancel-'));
  let seen: AbortSignal | undefined;
  const c2 = await startFakecat(dir2, {
    pair: async () => true,
    confirm: (req) =>
      new Promise((done) => {
        seen = req.signal;
        req.signal.addEventListener('abort', () => done('deny'), { once: true });
      }),
  });
  const s = net.connect(c2.host.entry().channel!);
  await new Promise((r) => s.once('connect', r));
  s.setEncoding('utf8');
  const lines: any[] = [];
  let buf = '';
  s.on('data', (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const waitFor = async (id: number) => {
    while (!lines.some((l) => l.id === id)) await new Promise((r) => setTimeout(r, 5));
    return lines.find((l) => l.id === id);
  };
  const write = (m: unknown) => s.write(JSON.stringify(m) + '\n');
  const t = await readFile(c2.host.entry().tokenFile!, 'utf8');
  write({ jsonrpc: '2.0', id: 1, method: 'hello', params: { protocol: PROTOCOL_VERSION, token: t, client: { name: 'cancel-test' }, server: { name: 'test', version: '0' } } });
  await waitFor(1);
  write({ jsonrpc: '2.0', id: 2, method: 'actions.call', params: { name: 'rename_toy', args: { id: 'mouse', name: 'Renamed' } } });
  while (!seen) await new Promise((r) => setTimeout(r, 5));
  write({ jsonrpc: '2.0', method: 'actions.cancel', params: { callId: 2 } });
  const answer = await waitFor(2);
  expect(answer.error.code).toBe(ErrorCodes.declined);
  expect(answer.error.message).toContain('nothing ran');
  expect(seen.aborted).toBe(true);
  s.destroy();
  await c2.stop();
  await rm(dir2, { recursive: true, force: true });
});

test('a question that cannot be put stops the action, and nothing runs unasked', async () => {
  const dir3 = await mkdtemp(path.join(os.tmpdir(), 'mcatzp-throw-'));
  const c3 = await startFakecat(dir3, {
    pair: async () => true,
    confirm: async () => {
      throw new Error('That port is taken');
    },
  });
  const s = net.connect(c3.host.entry().channel!);
  await new Promise((r) => s.once('connect', r));
  s.setEncoding('utf8');
  const lines: any[] = [];
  let buf = '';
  s.on('data', (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const waitFor = async (id: number) => {
    while (!lines.some((l) => l.id === id)) await new Promise((r) => setTimeout(r, 5));
    return lines.find((l) => l.id === id);
  };
  const write = (m: unknown) => s.write(JSON.stringify(m) + '\n');
  write({ jsonrpc: '2.0', id: 1, method: 'hello', params: { protocol: PROTOCOL_VERSION, token: await readFile(c3.host.entry().tokenFile!, 'utf8'), client: { name: 'throw-test' }, server: { name: 'test', version: '0' } } });
  await waitFor(1);
  write({ jsonrpc: '2.0', id: 2, method: 'actions.call', params: { name: 'rename_toy', args: { id: 'mouse', name: 'Renamed' } } });
  const answer = await waitFor(2);
  expect(answer.error.code).toBe(ErrorCodes.actionFailed);
  expect(answer.error.message).toBe('That port is taken');
  write({ jsonrpc: '2.0', id: 3, method: 'actions.call', params: { name: 'list_toys', args: {} } });
  expect((await waitFor(3)).result.text).toContain('Felt mouse');
  s.destroy();
  await c3.stop();
  await rm(dir3, { recursive: true, force: true });
});
