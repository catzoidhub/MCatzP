// Finding the cats: each app's bridge.json in its data folder. MCatzP only reads it; the app writes it.

import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type BridgeEntry, KNOWN_APPS, PROTOCOL_VERSION } from '@catzoid/mcatzp-protocol';

export type CatState =
  | 'not-installed' // no data folder
  | 'outdated' // installed, but no `mcatzp` entry (older than 1.1.0) or another protocol
  | 'off' // the MCatzP switch in the app is off
  | 'on';

export interface Cat {
  id: string;
  name: string;
  state: CatState;
  bridgeFile: string;
  version?: string;
  entry?: BridgeEntry;
}

export function appDataDir(name: string, env = process.env, platform = process.platform): string {
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), name);
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name);
  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), name);
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function readCat(id: string, name: string, bridgeFile: string): Promise<Cat> {
  let doc: Record<string, unknown> | undefined;
  try {
    doc = JSON.parse(await readFile(bridgeFile, 'utf8'));
  } catch {
    const installed = await exists(path.dirname(bridgeFile));
    return { id, name, bridgeFile, state: installed ? 'outdated' : 'not-installed' };
  }
  const entry = doc?.mcatzp as BridgeEntry | undefined;
  const version = typeof doc?.version === 'string' ? doc.version : entry?.app?.version;
  if (!entry || typeof entry !== 'object' || entry.protocol !== PROTOCOL_VERSION) {
    return { id, name, bridgeFile, version, state: 'outdated' };
  }
  const on = entry.enabled && typeof entry.channel === 'string' && typeof entry.tokenFile === 'string';
  return { id, name, bridgeFile, version: entry.app?.version ?? version, entry, state: on ? 'on' : 'off' };
}

/**
 * The four Catzoid apps, plus any bridge.json listed in MCATZP_BRIDGE_PATHS (a test cat such as fakecat).
 * MCATZP_NO_DEFAULT_APPS=1 leaves the four out (tests on a computer that has the real apps).
 */
export async function discover(env = process.env): Promise<Cat[]> {
  const cats: Promise<Cat>[] = [];
  if (env.MCATZP_NO_DEFAULT_APPS !== '1') {
    for (const a of KNOWN_APPS) cats.push(readCat(a.id, a.name, path.join(appDataDir(a.name, env), 'bridge.json')));
  }
  for (const file of (env.MCATZP_BRIDGE_PATHS ?? '').split(path.delimiter).filter(Boolean)) {
    cats.push(
      readCat('', '', file).then(async (c) => {
        const id = c.entry?.app?.id ?? path.basename(path.dirname(file)).toLowerCase();
        return { ...c, id, name: c.entry?.app?.name ?? id };
      }),
    );
  }
  return Promise.all(cats);
}

export function describeState(c: Cat): string {
  switch (c.state) {
    case 'not-installed':
      return `${c.name} is not installed.`;
    case 'outdated':
      return `${c.name}${c.version ? ` ${c.version}` : ''} is installed but cannot talk to MCatzP yet: update it to 1.1.0 or later.`;
    case 'off':
      return `${c.name} is installed, but MCatzP is off in it: turn it on in ${c.name} → Settings → AI → MCatzP.`;
    case 'on':
      return `${c.name} has MCatzP on.`;
  }
}
