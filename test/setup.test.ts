import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { addToClient, approvalsAcrossApps, install, installPath, removeFromClient, setupState, targets } from '@catzoid/mcatzp-host';

// macOS: `ditto`, a shell script as the "program".
const root = mkdtempSync(join(tmpdir(), 'mcatzp-setup-'));
afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

function zipOf(name: string, files: Record<string, string>): string {
  const dir = join(root, 'zips', name);
  mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    writeFileSync(join(dir, f), text);
    chmodSync(join(dir, f), 0o755);
  }
  const zip = join(root, 'zips', `${name}.zip`);
  execFileSync('/usr/bin/zip', ['-qj', zip, ...Object.keys(files).map((f) => join(dir, f))]);
  return zip;
}
const program = (v: string) => `#!/bin/sh\necho ${v}\n`;
const ZIPS: Record<string, { version: string; zip: string; sha?: string }> = {
  good: { version: '1.0.0', zip: zipOf('good', { mcatzp: program('1.0.0') }) },
  newer: { version: '1.1.0', zip: zipOf('newer', { mcatzp: program('1.1.0') }) },
  badsum: { version: '1.0.0', zip: zipOf('badsum', { mcatzp: program('1.0.0') }), sha: 'a'.repeat(64) },
  broken: { version: '1.0.0', zip: zipOf('broken', { mcatzp: '#!/bin/sh\nexit 1\n' }) },
  wrong: { version: '2.0.0', zip: zipOf('wrong', { mcatzp: program('1.0.0') }) },
  empty: { version: '1.0.0', zip: zipOf('empty', { other: 'x' }) },
};
let mode: string | null = null;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    const z = mode ? ZIPS[mode] : null;
    if (!z) return new Response('no', { status: 404 });
    const bytes = readFileSync(z.zip);
    if (u.pathname === '/api/mcatzp/latest') return Response.json({ version: z.version, sha256: z.sha ?? createHash('sha256').update(bytes).digest('hex') });
    return new Response(bytes);
  },
});

let n = 0;
function machine(extra: { path?: string } = {}) {
  const home = join(root, `home${n++}`);
  mkdirSync(home, { recursive: true });
  return { site: `http://127.0.0.1:${server.port}`, home, platform: 'darwin' as const, arch: 'arm64', env: { PATH: extra.path ?? '/usr/bin:/bin' } };
}
const never = new AbortController().signal;
const noop = () => {};
const left = (o: ReturnType<typeof machine>) => readdirSync(join(o.home, '.catzoid', 'bin')).filter((f) => f.startsWith('.'));

describe('the program', () => {
  test('no build for this computer', async () => {
    mode = null;
    const o = machine();
    expect(await setupState(o)).toMatchObject({ path: null, noBuild: true, checked: true });
    expect(install(o, noop, never)).rejects.toThrow('no build');
    const linux = await setupState({ ...o, platform: 'linux' });
    expect(linux.noBuild).toBe(true);
  });
  test('without asking the site', async () => {
    mode = null;
    expect(await setupState(machine(), false)).toMatchObject({ checked: false, latest: null, noBuild: false });
  });
  test('installs at the shared path, then updates', async () => {
    const o = machine();
    mode = 'good';
    await install(o, noop, never);
    const path = join(o.home, '.catzoid', 'bin', 'mcatzp');
    expect(installPath(o)).toBe(path);
    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(await setupState(o)).toMatchObject({ path, version: '1.0.0', source: 'catzoid', latest: '1.0.0' });
    mode = 'newer';
    expect(await setupState(o)).toMatchObject({ version: '1.0.0', latest: '1.1.0' });
    await install(o, noop, never);
    expect((await setupState(o)).version).toBe('1.1.0');
    expect(left(o)).toEqual([]);
  });
  test.each([
    ['badsum', 'Checksum mismatch'],
    ['broken', 'does not start'],
    ['wrong', 'not the 2.0.0'],
    ['empty', 'no MCatzP program'],
  ])('%s is refused and leaves nothing', async (m, message) => {
    const o = machine();
    mode = m;
    await expect(install(o, noop, never)).rejects.toThrow(message);
    expect(existsSync(installPath(o))).toBe(false);
    expect(left(o)).toEqual([]);
  });
  test('one install at a time, across apps', async () => {
    const o = machine();
    mode = 'good';
    mkdirSync(join(o.home, '.catzoid', 'bin', '.install.lock'), { recursive: true });
    await expect(install(o, noop, never)).rejects.toThrow('Another Catzoid app');
    expect(existsSync(installPath(o))).toBe(false);
  });
  test('cancel stops it', async () => {
    const o = machine();
    mode = 'good';
    const a = new AbortController();
    a.abort();
    await expect(install(o, noop, a.signal)).rejects.toThrow();
    expect(existsSync(installPath(o))).toBe(false);
    expect(left(o)).toEqual([]);
  });
  test('a copy on the PATH is used, never a second one', async () => {
    const bin = join(root, 'pathbin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'mcatzp'), program('0.9.0'));
    chmodSync(join(bin, 'mcatzp'), 0o755);
    const o = machine({ path: `${bin}${delimiter}/usr/bin:/bin` });
    mode = 'good';
    expect(await setupState(o)).toMatchObject({ path: join(bin, 'mcatzp'), version: '0.9.0', source: 'other' });
  });
  test('Windows path', () => {
    expect(installPath({ site: '', platform: 'win32', home: 'H', env: { LOCALAPPDATA: 'L' } })).toBe(join('L', 'Catzoid', 'bin', 'mcatzp.exe'));
  });
});

describe('Add to client', () => {
  async function ready(extra: { path?: string } = {}) {
    const o = machine(extra);
    mode = 'good';
    await install(o, noop, never);
    return { o, bin: installPath(o) };
  }
  test('needs the program', async () => {
    await expect(addToClient(machine(), 'zcode')).rejects.toThrow('Install MCatzP first');
  });
  test('ZCode: an existing entry in any case is reused, the rest kept, the old file backed up', async () => {
    const { o, bin } = await ready();
    const file = join(o.home, '.zcode', 'cli', 'config.json');
    mkdirSync(join(o.home, '.zcode', 'cli'), { recursive: true });
    writeFileSync(file, JSON.stringify({ other: 1, mcp: { timeout: 5, servers: { MCatzP: { command: '/x/bun', args: ['a'] }, keep: { command: '/k' } } } }));
    expect((await targets(o)).find((t) => t.id === 'zcode')).toMatchObject({ found: true, command: '/x/bun', current: false });
    await addToClient(o, 'zcode');
    const conf = JSON.parse(readFileSync(file, 'utf8'));
    expect(conf.other).toBe(1);
    expect(conf.mcp.timeout).toBe(5);
    expect(conf.mcp.servers).toEqual({ MCatzP: { type: 'stdio', command: bin, args: [], env: {} }, keep: { command: '/k' } });
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).mcp.servers.MCatzP.command).toBe('/x/bun');
    expect((await targets(o)).find((t) => t.id === 'zcode')?.current).toBe(true);
    await removeFromClient(o, 'zcode');
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcp.servers)).toEqual(['keep']);
  });
  test('ZCode: an unreadable file is left alone', async () => {
    const { o } = await ready();
    const file = join(o.home, '.zcode', 'cli', 'config.json');
    mkdirSync(join(o.home, '.zcode', 'cli'), { recursive: true });
    writeFileSync(file, '{broken');
    await expect(addToClient(o, 'zcode')).rejects.toThrow('Could not read');
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });
  test('ZCode: no file yet', async () => {
    const { o, bin } = await ready();
    mkdirSync(join(o.home, '.zcode'), { recursive: true });
    await addToClient(o, 'zcode');
    expect(JSON.parse(readFileSync(join(o.home, '.zcode', 'cli', 'config.json'), 'utf8')).mcp.servers.mcatzp.command).toBe(bin);
  });
  test('Claude Code: through its own command, with a path that has spaces', async () => {
    const cli = join(root, 'fake claude');
    mkdirSync(cli, { recursive: true });
    const log = join(root, 'claude.log');
    writeFileSync(join(cli, 'claude'), `#!/bin/sh\nfor a in "$@"; do printf '[%s]' "$a" >> "${log}"; done\necho >> "${log}"\n`);
    chmodSync(join(cli, 'claude'), 0o755);
    const { o, bin } = await ready({ path: `${cli}${delimiter}/usr/bin:/bin` });
    expect((await targets(o)).find((t) => t.id === 'claude-code')?.found).toBe(true);
    await addToClient(o, 'claude-code');
    expect(readFileSync(log, 'utf8')).toContain(`[mcp][add][--scope][user][mcatzp][--][${bin}]`);
    writeFileSync(join(o.home, '.claude.json'), JSON.stringify({ mcpServers: { MCATZP: { command: '/old' } } }));
    await addToClient(o, 'claude-code');
    const lines = readFileSync(log, 'utf8');
    expect(lines).toContain('[mcp][remove][--scope][user][MCATZP]');
    expect(lines).toContain(`[mcp][add][--scope][user][MCATZP][--][${bin}]`);
  });
  const MAC = 'Library/Application Support';
  test.each([
    ['claude-desktop', `${MAC}/Claude`, `${MAC}/Claude/claude_desktop_config.json`, ['mcpServers']],
    ['cursor', '.cursor', '.cursor/mcp.json', ['mcpServers']],
    ['windsurf', '.codeium/windsurf', '.codeium/windsurf/mcp_config.json', ['mcpServers']],
    ['vscode', `${MAC}/Code/User`, `${MAC}/Code/User/mcp.json`, ['servers']],
    ['cline', `${MAC}/Code/User/globalStorage/saoudrizwan.claude-dev`, `${MAC}/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`, ['mcpServers']],
    ['gemini', '.gemini', '.gemini/settings.json', ['mcpServers']],
    ['opencode', '.config/opencode', '.config/opencode/opencode.json', ['mcp']],
    ['copilot', '.copilot', '.copilot/mcp-config.json', ['mcpServers']],
    ['kiro', '.kiro', '.kiro/settings/mcp.json', ['mcpServers']],
    ['antigravity', '.gemini/antigravity', '.gemini/antigravity/mcp_config.json', ['mcpServers']],
    ['qwen', '.qwen', '.qwen/settings.json', ['mcpServers']],
    ['lmstudio', '.lmstudio', '.lmstudio/mcp.json', ['mcpServers']],
    ['roo', `${MAC}/Code/User/globalStorage/rooveterinaryinc.roo-cline`, `${MAC}/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`, ['mcpServers']],
    ['warp', '.warp', '.warp/.mcp.json', ['mcpServers']],
    ['amp', '.config/amp', '.config/amp/settings.json', ['amp.mcpServers']],
  ] as const)('%s: found, added beside what is there, removed', async (id, dir, file, key) => {
    const { o, bin } = await ready();
    const row = async () => (await targets(o)).find((t) => t.id === id)!;
    // Warp also counts as found from /Applications, which is this machine's, not the test's.
    if (id !== 'warp') expect((await row()).found).toBe(false);
    mkdirSync(join(o.home, dir), { recursive: true });
    expect(await row()).toMatchObject({ found: true, command: null, current: false });
    const path = join(o.home, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ theme: 'x', [key[0]]: { other: { command: '/k' } } }));
    await addToClient(o, id);
    const conf = JSON.parse(readFileSync(path, 'utf8'));
    expect(conf.theme).toBe('x');
    expect(conf[key[0]].other.command).toBe('/k');
    expect(conf[key[0]].mcatzp.command).toEqual(id === 'opencode' ? [bin] : bin);
    expect((await row()).current).toBe(true);
    await removeFromClient(o, id);
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8'))[key[0]])).toEqual(['other']);
  });
  test('a file with comments is left alone', async () => {
    const { o } = await ready();
    const path = join(o.home, MAC, 'Code', 'User', 'mcp.json');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '// mine\n{"servers":{}}');
    await expect(addToClient(o, 'vscode')).rejects.toThrow('Could not read');
    expect(readFileSync(path, 'utf8')).toBe('// mine\n{"servers":{}}');
  });
  test('Codex: TOML, only its own table', async () => {
    const { o, bin } = await ready();
    const path = join(o.home, '.codex', 'config.toml');
    mkdirSync(join(path, '..'), { recursive: true });
    const before = 'model = "x"\n\n[mcp_servers.other]\ncommand = "/k"\n\n[profiles.a]\nb = 1\n';
    writeFileSync(path, before);
    expect((await targets(o)).find((t) => t.id === 'codex')).toMatchObject({ found: true, command: null });
    await addToClient(o, 'codex');
    let text = readFileSync(path, 'utf8');
    expect(text).toContain(before.trim());
    expect(text).toContain(`[mcp_servers.mcatzp]\ncommand = ${JSON.stringify(bin)}\nargs = []`);
    expect((await targets(o)).find((t) => t.id === 'codex')?.current).toBe(true);
    await removeFromClient(o, 'codex');
    text = readFileSync(path, 'utf8');
    expect(text).not.toContain('mcatzp');
    expect(text).toContain('[mcp_servers.other]');
    // An old entry in another case, with a subtable, in the middle: replaced, the next table kept.
    writeFileSync(path, 'a = 1\n[mcp_servers.MCatzP]\ncommand = "/old"\nargs = ["x"]\n[mcp_servers.MCatzP.env]\nK = "v"\n\n[profiles.a]\nb = 1\n');
    expect((await targets(o)).find((t) => t.id === 'codex')?.command).toBe('/old');
    await addToClient(o, 'codex');
    text = readFileSync(path, 'utf8');
    expect(text).toContain(`[mcp_servers.MCatzP]\ncommand = ${JSON.stringify(bin)}`);
    expect(text).not.toContain('/old');
    expect(text).not.toContain('K = "v"');
    expect(text).toContain('[profiles.a]\nb = 1');
    expect(readFileSync(`${path}.bak`, 'utf8')).toContain('/old');
  });
  test('Claude Code shows its account', async () => {
    const o = machine();
    writeFileSync(join(o.home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@example.com', accountUuid: 'x' } }));
    expect((await targets(o)).find((t) => t.id === 'claude-code')?.account).toBe('a@example.com');
  });
  test('Claude Code absent', async () => {
    expect((await targets(machine())).find((t) => t.id === 'claude-code')?.found).toBe(false);
  });
});

describe('where a client is approved', () => {
  test('read from every app, nothing from an app that is off or does not say', () => {
    const o = machine();
    const write = (app: string, mcatzp: object) => {
      const dir = join(o.home, 'Library', 'Application Support', app);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'bridge.json'), JSON.stringify({ mcatzp }));
    };
    write('DevCatz', { enabled: true, approved: ['zcode', 'claude-code'] });
    write('DBCatz', { enabled: false, approved: ['zcode'] });
    write('DialCatz', { enabled: true });
    expect(approvalsAcrossApps(o).map((a) => [a.name, a.clients])).toEqual([
      ['DevCatz', ['zcode', 'claude-code']],
      ['DBCatz', []],
      ['DialCatz', []],
      ['DoCatz', []],
    ]);
  });
});

