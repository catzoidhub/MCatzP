// The MCatzP program on this computer, for every Catzoid app: one copy at one path, installed or updated from any of
// them, and the entry in an AI assistant that runs it. What stays per app (the switch, approved clients, what is
// shared) is not here. Nothing here asks the user: the app's button is the question.

import { exec, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface SetupOptions {
  /** The Catzoid site the build comes through. */
  site: string;
  /** The environment programs run with; an app started from the desktop passes its login shell's. */
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

export interface McatzpSetup {
  path: string | null;
  version: string | null;
  /** `catzoid`: at the shared path, updated from the apps. Others update their own way (Homebrew, npm). */
  source: 'catzoid' | 'homebrew' | 'other' | null;
  latest: string | null;
  /** The site has no build for this computer. */
  noBuild: boolean;
  /** The site could not be asked. */
  error: string | null;
  /** The site was asked; until then latest and noBuild say nothing. */
  checked: boolean;
}

export interface McatzpInstallProgress {
  phase: 'download' | 'install';
  received: number;
  total: number;
}

export const MCATZP_TARGETS = ['claude-code', 'zcode', 'claude-desktop', 'cursor', 'windsurf', 'vscode', 'cline', 'gemini', 'codex', 'opencode'] as const;
export type McatzpTargetId = (typeof MCATZP_TARGETS)[number];

export interface McatzpTarget {
  id: McatzpTargetId;
  label: string;
  /** It is on this computer. */
  found: boolean;
  /** What its mcatzp entry runs; null when it has none. */
  command: string | null;
  /** The entry runs the copy in use. */
  current: boolean;
  /** The account signed in to it, when the assistant keeps that on this computer. */
  account?: string;
}

const STALL_MS = 60_000;
/** An install this old was cut short: its lock no longer means anything. */
const LOCK_STALE_MS = 10 * 60_000;

const ctx = (o: SetupOptions) => {
  const platform = o.platform ?? process.platform;
  return { win: platform === 'win32', mac: platform === 'darwin', arch: o.arch ?? process.arch, env: o.env ?? process.env, home: o.home ?? homedir() };
};
type Ctx = ReturnType<typeof ctx>;

/** The one path of the shared copy: ~/.catzoid/bin/mcatzp, %LOCALAPPDATA%\Catzoid\bin\mcatzp.exe. */
export function installPath(o: SetupOptions): string {
  const c = ctx(o);
  return c.win ? join(c.env.LOCALAPPDATA ?? join(c.home, 'AppData', 'Local'), 'Catzoid', 'bin', 'mcatzp.exe') : join(c.home, '.catzoid', 'bin', 'mcatzp');
}

/** The site's name for this computer; null when MCatzP has no build for it. */
function platformName(c: Ctx): 'mac-arm64' | 'mac-x64' | 'win-x64' | null {
  if (c.mac) return c.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return c.win && c.arch === 'x64' ? 'win-x64' : null;
}

const run = (c: Ctx, file: string, args: string[], timeout: number) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(file, args, { env: c.env, timeout, windowsHide: true }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, stdout: String(stdout), stderr: String(stderr) }));
  });

/** stdout only: under Rosetta Bun warns about AVX on stderr, and a first start can take many seconds. */
async function versionOf(c: Ctx, path: string): Promise<string | null> {
  const { code, stdout } = await run(c, path, ['--version'], 30_000);
  return code === 0 ? (stdout.trim().match(/^\d+\.\d+[\w.+-]*$/)?.[0] ?? null) : null;
}

const HOMEBREW = ['/opt/homebrew/bin', '/usr/local/bin'];
const pathDirs = (c: Ctx) => (c.env.PATH ?? c.env.Path ?? '').split(delimiter).filter(Boolean);

/** The copy in use: the shared one first, then one on the PATH or in Homebrew's folder; never a second install next to it. */
async function findInstalled(o: SetupOptions): Promise<Pick<McatzpSetup, 'path' | 'version' | 'source'>> {
  const c = ctx(o);
  const ours = installPath(o);
  const exe = c.win ? 'mcatzp.exe' : 'mcatzp';
  const dirs = [...pathDirs(c), ...(c.mac ? HOMEBREW : [])];
  for (const path of [ours, ...dirs.map((d) => join(d, exe))]) {
    if (!existsSync(path)) continue;
    const version = await versionOf(c, path);
    if (version) return { path, version, source: path === ours ? 'catzoid' : HOMEBREW.includes(dirname(path)) ? 'homebrew' : 'other' };
  }
  return { path: null, version: null, source: null };
}

interface Latest {
  version: string;
  sha256: string;
}

/** What the site offers this computer; null when there is no build for it (404). */
async function latest(site: string, platform: string): Promise<Latest | null> {
  const res = await fetch(`${site}/api/mcatzp/latest?platform=${platform}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The site answered HTTP ${res.status}`);
  const body = (await res.json()) as Partial<Latest>;
  if (typeof body.version !== 'string' || typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(body.sha256)) throw new Error('The site gave no version or checksum for MCatzP');
  return { version: body.version, sha256: body.sha256.toLowerCase() };
}

/** `askSite` false: what is on this computer, at once; the site can take seconds to answer, or never. */
export async function setupState(o: SetupOptions, askSite = true): Promise<McatzpSetup> {
  const found = await findInstalled(o);
  const platform = platformName(ctx(o));
  const base = { ...found, latest: null, noBuild: !platform, error: null, checked: askSite };
  if (!platform || !askSite) return base;
  try {
    const l = await latest(o.site, platform);
    return { ...base, latest: l?.version ?? null, noBuild: !l };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

async function download(url: string, dest: string, sha256: string, progress: (received: number, total: number) => void, signal: AbortSignal): Promise<void> {
  // A connection that stops sending would otherwise wait forever.
  const stall = new AbortController();
  const both = AbortSignal.any([signal, stall.signal]);
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => stall.abort(), STALL_MS);
  };
  kick();
  try {
    const res = await fetch(url, { signal: both, cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const hash = createHash('sha256');
    let received = 0;
    let last = 0;
    const body = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream);
    body.on('data', (chunk: Buffer) => {
      kick();
      hash.update(chunk);
      received += chunk.length;
      if (Date.now() - last > 150) {
        last = Date.now();
        progress(received, total);
      }
    });
    await pipeline(body, createWriteStream(dest), { signal: both });
    progress(received, total);
    if (hash.digest('hex') !== sha256) throw new Error('Checksum mismatch, download discarded');
  } catch (e) {
    if (stall.signal.aborted && !signal.aborted) throw new Error('The download stopped receiving data: try again');
    throw e;
  } finally {
    clearTimeout(watchdog);
  }
}

/** One install at a time on this computer, whichever app starts it. */
function takeLock(dir: string): () => void {
  const lock = join(dir, '.install.lock');
  mkdirSync(dir, { recursive: true });
  try {
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
  } catch {
    throw new Error('Another Catzoid app is installing MCatzP: try again in a moment');
  }
  return () => rmSync(lock, { recursive: true, force: true });
}

/** Downloads, checks and installs the build for this computer, at the shared path. */
export async function install(o: SetupOptions, progress: (p: McatzpInstallProgress) => void, signal: AbortSignal): Promise<void> {
  const c = ctx(o);
  const platform = platformName(c);
  const l = platform ? await latest(o.site, platform) : null;
  if (!platform || !l) throw new Error('MCatzP has no build for this computer yet');
  const target = installPath(o);
  const release = takeLock(dirname(target));
  const tmp = join(dirname(target), `.install-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const archive = join(tmp, 'mcatzp.zip');
    await download(`${o.site}/download/mcatzp/${platform}`, archive, l.sha256, (received, total) => progress({ phase: 'download', received, total }), signal);
    progress({ phase: 'install', received: 0, total: 0 });
    const unpacked = join(tmp, 'out');
    mkdirSync(unpacked);
    // Windows 10+ ships bsdtar as tar.exe, which unpacks zips.
    const tar = join(c.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    const { code, stderr } = c.win ? await run(c, tar, ['-xf', archive, '-C', unpacked], 120_000) : await run(c, '/usr/bin/ditto', ['-x', '-k', archive, unpacked], 120_000);
    if (code !== 0) throw new Error(`Could not unpack MCatzP: ${stderr.trim()}`);
    const built = join(unpacked, c.win ? 'mcatzp.exe' : 'mcatzp');
    if (!existsSync(built) || !lstatSync(built).isFile()) throw new Error('The download holds no MCatzP program');
    if (!c.win) chmodSync(built, 0o755);
    const version = await versionOf(c, built);
    if (!version) throw new Error('The downloaded MCatzP does not start on this computer');
    if (version !== l.version) throw new Error(`The download is MCatzP ${version}, not the ${l.version} the site offers`);
    try {
      renameSync(built, target);
    } catch (e) {
      // Windows keeps a running .exe locked: fine when what runs there already is this version.
      if (c.win && (await versionOf(c, target)) === l.version) return;
      if (c.win) throw new Error('MCatzP is in use: close the AI assistant using it, then try again');
      throw e;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    release();
  }
}

/** An entry named mcatzp in any case is the same entry, so a client never lists two. */
const entryOf = (servers: unknown): [string, { command?: string | string[] }] | null => {
  if (!servers || typeof servers !== 'object') return null;
  return Object.entries(servers as Record<string, { command?: string | string[] }>).find(([k]) => k.toLowerCase() === 'mcatzp') ?? null;
};
const readJson = (file: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const claudeFile = (c: Ctx) => join(c.home, '.claude.json');
const codexFile = (c: Ctx) => join(c.home, '.codex', 'config.toml');
/** Where desktop apps keep their settings. */
const appData = (c: Ctx) => (c.win ? (c.env.APPDATA ?? join(c.home, 'AppData', 'Roaming')) : join(c.home, 'Library', 'Application Support'));
const vscodeUser = (c: Ctx) => join(appData(c), 'Code', 'User');
const onPath = (c: Ctx, name: string) => pathDirs(c).some((d) => [name, `${name}.exe`, `${name}.cmd`].some((n) => existsSync(join(d, n))));

/** Through its own command, which guards the file Claude Code keeps writing to. A shell: on Windows it may be a .cmd. */
const claudeCli = (c: Ctx, args: string) =>
  new Promise<{ code: number; output: string }>((resolve) => {
    exec(`claude mcp ${args}`, { cwd: c.home, env: c.env, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, output: `${stdout}${stderr}`.trim() }));
  });

/** The assistants that keep their servers in a JSON file: where, under which key, and in what shape. */
interface JsonClient {
  id: McatzpTargetId;
  label: string;
  found: (c: Ctx) => boolean;
  file: (c: Ctx) => string;
  key: string[];
  entry: (command: string) => Record<string, unknown>;
}
const plain = (command: string) => ({ command, args: [], env: {} });
const typed = (command: string) => ({ type: 'stdio', ...plain(command) });
const JSON_CLIENTS: JsonClient[] = [
  { id: 'zcode', label: 'ZCode', found: (c) => existsSync(join(c.home, '.zcode')), file: (c) => join(c.home, '.zcode', 'cli', 'config.json'), key: ['mcp', 'servers'], entry: typed },
  { id: 'claude-desktop', label: 'Claude Desktop', found: (c) => existsSync(join(appData(c), 'Claude')), file: (c) => join(appData(c), 'Claude', 'claude_desktop_config.json'), key: ['mcpServers'], entry: plain },
  { id: 'cursor', label: 'Cursor', found: (c) => existsSync(join(c.home, '.cursor')), file: (c) => join(c.home, '.cursor', 'mcp.json'), key: ['mcpServers'], entry: plain },
  { id: 'windsurf', label: 'Windsurf', found: (c) => existsSync(join(c.home, '.codeium', 'windsurf')), file: (c) => join(c.home, '.codeium', 'windsurf', 'mcp_config.json'), key: ['mcpServers'], entry: plain },
  { id: 'vscode', label: 'VS Code', found: (c) => existsSync(vscodeUser(c)), file: (c) => join(vscodeUser(c), 'mcp.json'), key: ['servers'], entry: typed },
  {
    id: 'cline',
    label: 'Cline',
    found: (c) => existsSync(join(vscodeUser(c), 'globalStorage', 'saoudrizwan.claude-dev')),
    file: (c) => join(vscodeUser(c), 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
    key: ['mcpServers'],
    entry: (command) => ({ ...plain(command), disabled: false }),
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    found: (c) => existsSync(join(c.home, '.config', 'opencode')) || onPath(c, 'opencode'),
    file: (c) => join(c.home, '.config', 'opencode', 'opencode.json'),
    key: ['mcp'],
    entry: (command) => ({ type: 'local', command: [command], enabled: true }),
  },
  { id: 'gemini', label: 'Gemini CLI', found: (c) => existsSync(join(c.home, '.gemini')) || onPath(c, 'gemini'), file: (c) => join(c.home, '.gemini', 'settings.json'), key: ['mcpServers'], entry: plain },
];
const dig = (conf: Record<string, unknown> | null, key: string[]): unknown => key.reduce<unknown>((at, k) => (at as Record<string, unknown> | undefined)?.[k], conf ?? undefined);

/** Writes `text` beside `file` first and moves it over, a copy of the old file left as .bak. */
function replaceFile(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** A client's JSON file with `change` applied to its servers; the rest of the file stays. */
function editJson(file: string, key: string[], change: (servers: Record<string, unknown>) => void): void {
  const conf = existsSync(file) ? readJson(file) : {};
  // Never over a file that could not be read (comments too): what it holds would be lost.
  if (!conf) throw new Error(`Could not read ${file}: fix it or add MCatzP by hand`);
  let at: Record<string, unknown> = conf;
  for (const k of key) {
    if (!at[k] || typeof at[k] !== 'object') at[k] = {};
    at = at[k] as Record<string, unknown>;
  }
  change(at);
  replaceFile(file, `${JSON.stringify(conf, null, 2)}\n`);
}

/** Codex keeps TOML: one [mcp_servers.<name>] table per server. Only that table, with its subtables, is touched. */
const codexTable = (text: string): { name: string; start: number; end: number; command: string } | null => {
  const head = /^[ \t]*\[mcp_servers\.("?)([^\]."]+)\1\][ \t]*\r?$/gim;
  for (let m = head.exec(text); m; m = head.exec(text)) {
    const name = m[2] ?? '';
    if (name.toLowerCase() !== 'mcatzp') continue;
    const rest = text.slice(m.index + m[0].length);
    const next = [...rest.matchAll(/^[ \t]*\[([^\]\n]*)\]/gm)].find((n) => !(n[1] ?? '').replace(/"/g, '').toLowerCase().startsWith(`mcp_servers.${name.toLowerCase()}.`));
    const end = next ? m.index + m[0].length + (next.index ?? 0) : text.length;
    const body = text.slice(m.index, end);
    const command = body.match(/^[ \t]*command[ \t]*=[ \t]*("(?:[^"\\]|\\.)*"|'[^']*')/m)?.[1] ?? '""';
    let value = '';
    try {
      value = command.startsWith("'") ? command.slice(1, -1) : (JSON.parse(command) as string);
    } catch {
      /* written some other way: treated as another copy */
    }
    return { name, start: m.index, end, command: value };
  }
  return null;
};
const readText = (file: string) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

export async function targets(o: SetupOptions): Promise<McatzpTarget[]> {
  const c = ctx(o);
  const { path } = await findInstalled(o);
  const row = (id: McatzpTargetId, label: string, found: boolean, command: string | null): McatzpTarget => ({ id, label, found, command, current: command !== null && !!path && command === path });
  const commandOf = (servers: unknown) => {
    const entry = entryOf(servers);
    if (!entry) return null;
    // OpenCode keeps the command and its arguments in one list.
    const command = entry[1].command ?? '';
    return Array.isArray(command) ? command.join(' ') : command;
  };
  const claude = readJson(claudeFile(c));
  const account = (claude?.oauthAccount as { emailAddress?: unknown } | undefined)?.emailAddress;
  return [
    { ...row('claude-code', 'Claude Code', onPath(c, 'claude'), commandOf(claude?.mcpServers)), ...(typeof account === 'string' ? { account } : {}) },
    ...JSON_CLIENTS.map((j) => row(j.id, j.label, j.found(c), commandOf(dig(readJson(j.file(c)), j.key)))),
    row('codex', 'Codex CLI', existsSync(join(c.home, '.codex')) || onPath(c, 'codex'), codexTable(readText(codexFile(c)))?.command ?? null),
  ];
}

/** Adds the entry, or points an existing one at the copy in use. The path is always the one found here. */
export async function addToClient(o: SetupOptions, id: McatzpTargetId): Promise<void> {
  const c = ctx(o);
  const { path } = await findInstalled(o);
  if (!path) throw new Error('Install MCatzP first');
  const json = JSON_CLIENTS.find((j) => j.id === id);
  if (json) {
    editJson(json.file(c), json.key, (servers) => {
      servers[entryOf(servers)?.[0] ?? 'mcatzp'] = json.entry(path);
    });
    return;
  }
  if (id === 'codex') {
    const text = readText(codexFile(c));
    const table = codexTable(text);
    const block = `[mcp_servers.${table?.name ?? 'mcatzp'}]\ncommand = ${JSON.stringify(path)}\nargs = []\n`;
    const next = table ? `${text.slice(0, table.start)}${block}\n${text.slice(table.end).replace(/^\s+/, '')}` : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}`;
    replaceFile(codexFile(c), next);
    return;
  }
  const name = entryOf(readJson(claudeFile(c))?.mcpServers)?.[0];
  if (name) {
    const removed = await claudeCli(c, `remove --scope user "${name}"`);
    if (removed.code !== 0) throw new Error(removed.output || 'claude mcp remove failed');
  }
  const added = await claudeCli(c, `add --scope user "${name ?? 'mcatzp'}" -- "${path}"`);
  if (added.code !== 0) throw new Error(added.output || 'claude mcp add failed');
}

export async function removeFromClient(o: SetupOptions, id: McatzpTargetId): Promise<void> {
  const c = ctx(o);
  const json = JSON_CLIENTS.find((j) => j.id === id);
  if (json) {
    editJson(json.file(c), json.key, (servers) => {
      const name = entryOf(servers)?.[0];
      if (name) delete servers[name];
    });
    return;
  }
  if (id === 'codex') {
    const text = readText(codexFile(c));
    const table = codexTable(text);
    if (table) replaceFile(codexFile(c), `${text.slice(0, table.start)}${text.slice(table.end).replace(/^\s+/, '')}`);
    return;
  }
  const name = entryOf(readJson(claudeFile(c))?.mcpServers)?.[0];
  if (!name) return;
  const removed = await claudeCli(c, `remove --scope user "${name}"`);
  if (removed.code !== 0) throw new Error(removed.output || 'claude mcp remove failed');
}
