#!/usr/bin/env node
// Run fakecat in its own terminal; it asks pairing and confirmation questions there, as a real app would in a dialog.
//   bun run fakecat [--data <dir>]       FAKECAT_AUTO=once|session|deny answers without asking (tests).

import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import type { ConfirmAnswer } from '@catzoid/mcatzp-host';
import { startFakecat } from './cat.js';

const i = process.argv.indexOf('--data');
const dataDir = i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]!) : path.join(os.tmpdir(), 'mcatzp-fakecat');
const auto = process.env.FAKECAT_AUTO as ConfirmAnswer | undefined;
const rl = auto ? undefined : readline.createInterface({ input: process.stdin, output: process.stdout });
let queue = Promise.resolve<unknown>(undefined);
// The question goes on its own lines and the prompt is a short "> ", so a terminal that redraws (resizing a panel)
// keeps the question on screen.
const ask = (q: string) => {
  const next = queue.then(() => {
    process.stdout.write(`${q.trimEnd()}\n`);
    return rl!.question('> ');
  });
  queue = next.catch(() => {});
  return next;
};

const cat = await startFakecat(dataDir, {
  async pair(client) {
    if (auto) return auto !== 'deny';
    return /^y/i.test(await ask(`\n🐾 ${client.name}${client.version ? ` ${client.version}` : ''} wants to use Fakecat. Allow? [y/N] `));
  },
  async confirm(req) {
    if (auto) return auto;
    if (req.action.tier === 'destructive') {
      const id = String(req.args.id ?? '');
      const typed = await ask(`\n⚠️  ${req.client}: ${req.summary}\n   Type the toy id (${id}) to confirm: `);
      return typed.trim() === id ? 'once' : 'deny';
    }
    const choices = req.allowSession ? '[y]es / [s]ession / [N]o' : '[y]es / [N]o';
    const a = (await ask(`\n❓ ${req.client}: ${req.summary}\n   ${choices} `)).trim().toLowerCase();
    return a.startsWith('s') && req.allowSession ? 'session' : a.startsWith('y') ? 'once' : 'deny';
  },
  log: (e) => console.log(`  log · ${e.client} · ${e.action ?? e.method} · ${e.outcome}${e.reason ? ` (${e.reason})` : ''}`),
});

console.log(`Fakecat is listening (MCatzP protocol 1).
  bridge.json: ${cat.bridgeFile}
Point MCatzP at it, e.g.:
  claude mcp add mcatzp-dev -e MCATZP_BRIDGE_PATHS=${cat.bridgeFile} -- bun ${path.resolve('packages/server/src/index.ts')}
Ctrl+C stops it (the channel closes and bridge.json says MCatzP is off).`);

const stop = async () => {
  await cat.stop();
  rl?.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
