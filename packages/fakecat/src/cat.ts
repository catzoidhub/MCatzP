// Fakecat's actions: one of each tier, so MCatzP can be tried end to end before any real app speaks the protocol.

import path from 'node:path';
import { type ActionDef, type HostOptions, McatzpHost, writeBridgeEntry } from '@catzoid/mcatzp-host';

export interface Toy {
  id: string;
  name: string;
  squeaks: number;
}

export function fakecatActions(toys: Toy[]): ActionDef[] {
  const find = (id: unknown) => {
    const t = toys.find((x) => x.id === id);
    if (!t) throw new Error(`No toy with id ${String(id)}.`);
    return t;
  };
  return [
    {
      name: 'list_toys',
      title: 'List toys',
      description: "List fakecat's toys.",
      tier: 'read',
      input: { type: 'object', properties: {}, additionalProperties: false },
      run: () => ({ text: toys.map((t) => `${t.id}: ${t.name} (${t.squeaks} squeaks)`).join('\n') || 'No toys.', data: { toys } }),
    },
    {
      name: 'get_toy',
      title: 'Get a toy',
      description: 'Show one toy by its id.',
      tier: 'read',
      input: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      run: (a) => {
        const t = find(a.id);
        return { text: `${t.id}: ${t.name} (${t.squeaks} squeaks)`, data: { toy: t } };
      },
    },
    {
      name: 'rename_toy',
      title: 'Rename a toy',
      description: 'Give a toy a new name.',
      tier: 'change',
      allowSession: true,
      input: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string', minLength: 1, maxLength: 40 } },
        required: ['id', 'name'],
        additionalProperties: false,
      },
      run: (a) => {
        const t = find(a.id);
        const old = t.name;
        t.name = String(a.name);
        return { text: `Renamed ${old} to ${t.name}.` };
      },
    },
    {
      name: 'delete_toy',
      title: 'Delete a toy',
      description: 'Remove a toy for good.',
      tier: 'destructive',
      input: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      run: (a) => {
        const t = find(a.id);
        toys.splice(toys.indexOf(t), 1);
        return { text: `Deleted ${t.name}.` };
      },
    },
  ];
}

export function defaultToys(): Toy[] {
  return [
    { id: 'mouse', name: 'Felt mouse', squeaks: 3 },
    { id: 'ball', name: 'Bell ball', squeaks: 0 },
    { id: 'feather', name: 'Feather wand', squeaks: 1 },
  ];
}

/** Starts fakecat's channel in `dataDir` and writes its bridge.json there. */
export async function startFakecat(
  dataDir: string,
  ui: Pick<HostOptions, 'pair' | 'confirm' | 'log'> & Partial<HostOptions>,
  toys = defaultToys(),
): Promise<{ host: McatzpHost; bridgeFile: string; toys: Toy[]; stop(): Promise<void> }> {
  const paired = new Set<string>();
  const bridgeFile = path.join(dataDir, 'bridge.json');
  const host = new McatzpHost({
    app: { id: 'fakecat', name: 'Fakecat', version: '1.1.0' },
    dataDir,
    actions: fakecatActions(toys),
    isPaired: (n) => paired.has(n),
    onPaired: (n) => paired.add(n),
    describe: (a, args) => {
      const t = toys.find((x) => x.id === args.id);
      if (a.name === 'rename_toy') return `Rename "${t?.name ?? args.id}" to "${String(args.name)}"`;
      if (a.name === 'delete_toy') return `Delete "${t?.name ?? args.id}" for good`;
      return a.title;
    },
    ...ui,
  });
  await writeBridgeEntry(bridgeFile, await host.start());
  return {
    host,
    bridgeFile,
    toys,
    async stop() {
      await writeBridgeEntry(bridgeFile, await host.stop());
    },
  };
}
