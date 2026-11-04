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

export type McatzpTargetId = 'claude-code' | 'zcode';

export interface McatzpTarget {
  id: McatzpTargetId;
  label: string;
  /** It is on this computer. */
  found: boolean;
  /** What its mcatzp entry runs; null when it has none. */
  command: string | null;
  /** The entry runs the copy in use. */
  current: boolean;
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
const entryOf = (servers: unknown): [string, { command?: string }] | null => {
  if (!servers || typeof servers !== 'object') return null;
  return Object.entries(servers as Record<string, { command?: string }>).find(([k]) => k.toLowerCase() === 'mcatzp') ?? null;
};
const readJson = (file: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const claudeFile = (c: Ctx) => join(c.home, '.claude.json');
const zcodeDir = (c: Ctx) => join(c.home, '.zcode');
const zcodeFile = (c: Ctx) => join(zcodeDir(c), 'cli', 'config.json');

/** Through its own command, which guards the file Claude Code keeps writing to. A shell: on Windows it may be a .cmd. */
const claudeCli = (c: Ctx, args: string) =>
  new Promise<{ code: number; output: string }>((resolve) => {
    exec(`claude mcp ${args}`, { cwd: c.home, env: c.env, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, output: `${stdout}${stderr}`.trim() }));
  });
const hasClaudeCli = (c: Ctx) => pathDirs(c).some((d) => ['claude', 'claude.exe', 'claude.cmd'].some((n) => existsSync(join(d, n))));

export async function targets(o: SetupOptions): Promise<McatzpTarget[]> {
  const c = ctx(o);
  const { path } = await findInstalled(o);
  const row = (id: McatzpTargetId, label: string, found: boolean, servers: unknown): McatzpTarget => {
    const entry = entryOf(servers);
    const command = entry ? (entry[1].command ?? '') : null;
    return { id, label, found, command, current: command !== null && !!path && command === path };
  };
  return [
    row('claude-code', 'Claude Code', hasClaudeCli(c), readJson(claudeFile(c))?.mcpServers),
    row('zcode', 'ZCode', existsSync(zcodeDir(c)), (readJson(zcodeFile(c))?.mcp as { servers?: unknown } | undefined)?.servers),
  ];
}

/** ZCode's file with `change` applied to its servers: a copy of the old file beside it, written in one step. */
function editZcode(c: Ctx, change: (servers: Record<string, unknown>) => void): void {
  const file = zcodeFile(c);
  const exists = existsSync(file);
  const conf = exists ? readJson(file) : {};
  // Never over a file that could not be read: what it holds would be lost.
  if (!conf) throw new Error(`Could not read ${file}: fix it or remove it, then try again`);
  const mcp = (conf.mcp ?? {}) as { servers?: Record<string, unknown> };
  const servers = mcp.servers ?? {};
  change(servers);
  conf.mcp = { ...mcp, servers };
  mkdirSync(dirname(file), { recursive: true });
  if (exists) copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, `${JSON.stringify(conf, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Adds the entry, or points an existing one at the copy in use. The path is always the one found here. */
export async function addToClient(o: SetupOptions, id: McatzpTargetId): Promise<void> {
  const c = ctx(o);
  const { path } = await findInstalled(o);
  if (!path) throw new Error('Install MCatzP first');
  if (id === 'zcode') {
    editZcode(c, (servers) => {
      const name = entryOf(servers)?.[0] ?? 'mcatzp';
      servers[name] = { type: 'stdio', command: path, args: [], env: {} };
    });
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
  if (id === 'zcode') {
    editZcode(c, (servers) => {
      const name = entryOf(servers)?.[0];
      if (name) delete servers[name];
    });
    return;
  }
  const name = entryOf(readJson(claudeFile(c))?.mcpServers)?.[0];
  if (!name) return;
  const removed = await claudeCli(c, `remove --scope user "${name}"`);
  if (removed.code !== 0) throw new Error(removed.output || 'claude mcp remove failed');
}
