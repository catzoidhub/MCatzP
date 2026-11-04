// @catzoid/mcatzp-host — embedded by DevCatz, DBCatz, DialCatz and DoCatz. The app keeps the UI (pairing and
// confirmation dialogs, Settings, the log view); this package keeps the channel and the rules the same in all four.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import {
  type ActionInfo,
  type AppInfo,
  type BridgeEntry,
  type CallParams,
  type CallResult,
  encode,
  ErrorCodes,
  type HelloParams,
  type HelloResult,
  LineReader,
  type ListActionsResult,
  Methods,
  type Platform,
  PROTOCOL_VERSION,
  ProtocolError,
  type RpcRequest,
} from '@catzoid/mcatzp-protocol';

export interface ActionContext {
  client: string;
  /** Present when the client asked for progress: an action that takes a while reports here. */
  progress?(p: { message: string; percent?: number }): void;
  /** Aborts with the reason `cancelled` when the client gives up on the call, `closed` when its connection ends. */
  signal: AbortSignal;
}

export interface ActionDef extends ActionInfo {
  /** Where the action exists; omitted = every platform. */
  platforms?: Platform[];
  /** A low-risk change may offer "allow for this session" in its dialog. Never for destructive actions. */
  allowSession?: boolean;
  run(args: Record<string, unknown>, ctx: ActionContext): Promise<CallResult> | CallResult;
}

export interface ConfirmRequest {
  client: string;
  action: ActionInfo;
  args: Record<string, unknown>;
  /** What will happen, built from the real arguments (never from the assistant's own words). */
  summary: string;
  /** The dialog may show "allow for this session". */
  allowSession: boolean;
  /** The client gave up or left: nobody waits for an answer any more, so the question goes away. */
  signal: AbortSignal;
}

/** 'deny' | 'once' | 'session' — destructive actions treat 'session' as 'once'. */
export type ConfirmAnswer = 'deny' | 'once' | 'session';

export interface LogEntry {
  time: string;
  client: string;
  method: string;
  action?: string;
  tier?: ActionInfo['tier'];
  outcome: 'ok' | 'refused' | 'declined' | 'failed';
  reason?: string;
}

export interface HostOptions {
  app: AppInfo;
  /** The app's data folder (holds the socket and the token file on macOS). */
  dataDir: string;
  actions: ActionDef[] | (() => ActionDef[]);
  /** Ask the user to approve a client the first time it connects. */
  pair(client: HelloParams['client']): Promise<boolean>;
  /** Show the in-app confirmation for a change or destructive action. */
  confirm(req: ConfirmRequest): Promise<ConfirmAnswer>;
  /** Already-approved clients (the app persists them; revocable in Settings). */
  isPaired?(clientName: string): boolean;
  onPaired?(clientName: string): void;
  /** The approved clients' names, written to bridge.json so the other Catzoid apps can show where each is approved. */
  approved?(): string[];
  /** Whether the call is inside what the user shared; default: everything. */
  inScope?(action: ActionDef, args: Record<string, unknown>): boolean;
  /** One line for the dialog; default: the action title and its arguments. */
  describe?(action: ActionDef, args: Record<string, unknown>): string;
  log?(entry: LogEntry): void;
  platform?: Platform;
  /** Calls per second per connection, with a burst; default 10 / 20. */
  rateLimit?: { perSecond: number; burst: number };
}

interface Conn {
  socket: net.Socket;
  client?: string;
  sessionAllowed: Set<string>;
  /** Calls in progress, by request id. */
  calls: Map<unknown, AbortController>;
  tokens: number;
  last: number;
}

export class McatzpHost {
  private server?: net.Server;
  private token = '';
  private channel = '';
  private tokenFile = '';
  private conns = new Set<Conn>();
  private pairing = new Map<string, Promise<boolean>>();
  private validators = new WeakMap<ActionDef, ValidateFunction>();
  private ajv = new Ajv({ allErrors: true, strict: false });
  private readonly platform: Platform;

  constructor(private readonly opts: HostOptions) {
    this.platform = opts.platform ?? (process.platform === 'win32' ? 'win32' : 'darwin');
  }

  get running(): boolean {
    return !!this.server;
  }

  /** Opens the channel (the MCatzP switch went on) and returns the bridge.json `mcatzp` entry to write. */
  async start(): Promise<BridgeEntry> {
    if (this.server) return this.entry();
    await mkdir(this.opts.dataDir, { recursive: true });
    this.token = randomBytes(32).toString('hex');
    this.tokenFile = path.join(this.opts.dataDir, 'mcatzp.token');
    await rm(this.tokenFile, { force: true });
    await writeFile(this.tokenFile, this.token, { mode: 0o600 });
    if (this.platform === 'win32') {
      // Default pipe DACL: only the creator, Administrators and SYSTEM can write (MCatzP TODO #16 tests this).
      this.channel = `\\\\.\\pipe\\catzoid-${this.opts.app.id}-${randomBytes(8).toString('hex')}`;
    } else {
      this.channel = path.join(this.opts.dataDir, 'mcatzp.sock');
      await rm(this.channel, { force: true });
    }
    const server = net.createServer((s) => this.accept(s));
    const umask = this.platform === 'win32' ? undefined : process.umask(0o177);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.channel, () => resolve());
      });
    } finally {
      if (umask !== undefined) process.umask(umask);
    }
    if (this.platform !== 'win32') await chmod(this.channel, 0o600);
    this.server = server;
    return this.entry();
  }

  /** Closes the channel (switch off / app quits), removes the socket and token, returns the entry to write. */
  async stop(): Promise<BridgeEntry> {
    const server = this.server;
    this.server = undefined;
    for (const c of this.conns) c.socket.destroy();
    this.conns.clear();
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (this.tokenFile) await rm(this.tokenFile, { force: true });
    if (this.platform !== 'win32' && this.channel) await rm(this.channel, { force: true });
    this.token = '';
    return this.entry();
  }

  /** Tell connected MCatzP servers the action list or scopes changed. */
  notifyChanged(): void {
    for (const c of this.conns) if (c.client) c.socket.write(encode({ jsonrpc: '2.0', method: Methods.actionsChanged }));
  }

  entry(): BridgeEntry {
    const on = !!this.server;
    return {
      protocol: PROTOCOL_VERSION,
      enabled: on,
      ...(on ? { channel: this.channel, tokenFile: this.tokenFile, ...(this.opts.approved ? { approved: this.opts.approved() } : {}) } : {}),
      app: this.opts.app,
    };
  }

  private actions(): ActionDef[] {
    const list = typeof this.opts.actions === 'function' ? this.opts.actions() : this.opts.actions;
    return list.filter((a) => !a.platforms || a.platforms.includes(this.platform));
  }

  private accept(socket: net.Socket): void {
    const rate = this.opts.rateLimit ?? { perSecond: 10, burst: 20 };
    const conn: Conn = { socket, sessionAllowed: new Set(), calls: new Map(), tokens: rate.burst, last: Date.now() };
    this.conns.add(conn);
    socket.setEncoding('utf8');
    const reader = new LineReader(
      (line) => void this.onLine(conn, line),
      () => socket.destroy(),
    );
    socket.on('data', (d: string) => reader.push(d));
    socket.on('close', () => {
      this.conns.delete(conn);
      for (const c of conn.calls.values()) c.abort('closed');
    });
    socket.on('error', () => socket.destroy());
  }

  private async onLine(conn: Conn, line: string): Promise<void> {
    let req: RpcRequest;
    try {
      req = JSON.parse(line);
    } catch {
      conn.socket.write(encode({ jsonrpc: '2.0', id: null, error: { code: ErrorCodes.parseError, message: 'Parse error' } }));
      return;
    }
    if (req.id === undefined) {
      if (req.method === Methods.actionsCancel) conn.calls.get((req.params as { callId?: unknown })?.callId)?.abort('cancelled');
      return;
    }
    try {
      const result = await this.handle(conn, req);
      conn.socket.write(encode({ jsonrpc: '2.0', id: req.id, result }));
    } catch (e) {
      const err = e instanceof ProtocolError ? e : new ProtocolError(ErrorCodes.internal, 'Internal error');
      conn.socket.write(
        encode({ jsonrpc: '2.0', id: req.id, error: { code: err.code, message: err.message, data: err.data } }),
      );
    }
  }

  private async handle(conn: Conn, req: RpcRequest): Promise<unknown> {
    if (req.method === Methods.hello) return this.hello(conn, req.params as HelloParams);
    if (!conn.client) {
      this.write({ client: '?', method: req.method, outcome: 'refused', reason: 'no hello' });
      throw new ProtocolError(ErrorCodes.unauthorized, 'Say hello with the token first.');
    }
    this.takeToken(conn, req.method);
    if (req.method === Methods.listActions) {
      return { actions: this.actions().map(info) } satisfies ListActionsResult;
    }
    if (req.method === Methods.call) {
      const control = new AbortController();
      conn.calls.set(req.id, control);
      try {
        return await this.call(conn, req.params as CallParams, control.signal);
      } finally {
        conn.calls.delete(req.id);
      }
    }
    throw new ProtocolError(ErrorCodes.methodNotFound, `Unknown method ${req.method}`);
  }

  private async hello(conn: Conn, p: HelloParams): Promise<HelloResult> {
    const name = typeof p?.client?.name === 'string' && p.client.name.trim() ? p.client.name.trim().slice(0, 80) : '';
    if (!this.server || !checkToken(p?.token, this.token)) {
      this.write({ client: name || '?', method: Methods.hello, outcome: 'refused', reason: 'bad token' });
      throw new ProtocolError(ErrorCodes.unauthorized, 'Wrong or missing token.');
    }
    if (p.protocol !== PROTOCOL_VERSION) {
      throw new ProtocolError(ErrorCodes.protocolMismatch, `${this.opts.app.name} speaks MCatzP protocol ${PROTOCOL_VERSION}.`, {
        protocol: PROTOCOL_VERSION,
      });
    }
    if (!name) throw new ProtocolError(ErrorCodes.invalidParams, 'The client has no name.');
    if (!this.opts.isPaired?.(name)) {
      let pending = this.pairing.get(name);
      if (!pending) {
        pending = this.opts.pair({ name, version: p.client.version }).finally(() => this.pairing.delete(name));
        this.pairing.set(name, pending);
      }
      if (!(await pending)) {
        this.write({ client: name, method: Methods.hello, outcome: 'declined', reason: 'pairing denied' });
        throw new ProtocolError(ErrorCodes.pairingDenied, `${this.opts.app.name}: the user did not approve ${name}.`);
      }
      this.opts.onPaired?.(name);
    }
    conn.client = name;
    this.write({ client: name, method: Methods.hello, outcome: 'ok' });
    return { protocol: PROTOCOL_VERSION, app: { ...this.opts.app, platform: this.platform } };
  }

  private async call(conn: Conn, p: CallParams, signal: AbortSignal): Promise<CallResult> {
    const client = conn.client!;
    const action = this.actions().find((a) => a.name === p?.name);
    const base = { client, method: Methods.call, action: p?.name };
    if (!action) {
      this.write({ ...base, outcome: 'refused', reason: 'unknown action' });
      throw new ProtocolError(ErrorCodes.unknownAction, `${this.opts.app.name} has no action ${p?.name}.`);
    }
    const args = p.args && typeof p.args === 'object' && !Array.isArray(p.args) ? p.args : {};
    const validate = this.validator(action);
    if (!validate(args)) {
      this.write({ ...base, tier: action.tier, outcome: 'refused', reason: 'invalid arguments' });
      throw new ProtocolError(ErrorCodes.invalidParams, `Invalid arguments: ${this.ajv.errorsText(validate.errors)}`);
    }
    if (this.opts.inScope && !this.opts.inScope(action, args)) {
      this.write({ ...base, tier: action.tier, outcome: 'refused', reason: 'out of scope' });
      throw new ProtocolError(ErrorCodes.outOfScope, `Not shared with MCatzP in ${this.opts.app.name}'s settings.`);
    }
    if (action.tier !== 'read') {
      const allowSession = action.tier === 'change' && !!action.allowSession;
      const key = `${client}\u0000${action.name}`;
      if (!(allowSession && conn.sessionAllowed.has(key))) {
        const summary = this.opts.describe?.(action, args) ?? `${action.title}: ${JSON.stringify(args)}`;
        // A question that cannot be put (the target does not exist, the port is taken) is the end of it: nothing runs unasked.
        let answer: ConfirmAnswer;
        try {
          answer = await this.opts.confirm({ client, action: info(action), args, summary, allowSession, signal });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.write({ ...base, tier: action.tier, outcome: 'failed', reason: message });
          throw new ProtocolError(ErrorCodes.actionFailed, message);
        }
        if (signal.aborted) {
          this.write({ ...base, tier: action.tier, outcome: 'declined', reason: 'the client gave up on it' });
          throw new ProtocolError(ErrorCodes.declined, 'The client cancelled the call before it was allowed; nothing ran.');
        }
        if (answer === 'deny') {
          this.write({ ...base, tier: action.tier, outcome: 'declined' });
          throw new ProtocolError(ErrorCodes.declined, 'The user declined it in the app.');
        }
        if (answer === 'session' && allowSession) conn.sessionAllowed.add(key);
      }
    }
    try {
      const id = p.progressId;
      const progress =
        typeof id === 'number'
          ? (x: { message: string; percent?: number }) => {
              if (!conn.socket.destroyed) conn.socket.write(encode({ jsonrpc: '2.0', method: Methods.actionsProgress, params: { progressId: id, ...x } }));
            }
          : undefined;
      const result = await action.run(args, { client, signal, ...(progress ? { progress } : {}) });
      this.write({ ...base, tier: action.tier, outcome: 'ok' });
      return result;
    } catch (e) {
      this.write({ ...base, tier: action.tier, outcome: 'failed', reason: e instanceof Error ? e.message : String(e) });
      throw new ProtocolError(ErrorCodes.actionFailed, e instanceof Error ? e.message : String(e));
    }
  }

  private validator(action: ActionDef): ValidateFunction {
    let v = this.validators.get(action);
    if (!v) {
      v = this.ajv.compile(action.input);
      this.validators.set(action, v);
    }
    return v;
  }

  private takeToken(conn: Conn, method: string): void {
    const rate = this.opts.rateLimit ?? { perSecond: 10, burst: 20 };
    const now = Date.now();
    conn.tokens = Math.min(rate.burst, conn.tokens + ((now - conn.last) / 1000) * rate.perSecond);
    conn.last = now;
    if (conn.tokens < 1) {
      this.write({ client: conn.client ?? '?', method, outcome: 'refused', reason: 'rate limit' });
      throw new ProtocolError(ErrorCodes.rateLimited, 'Too many calls; slow down.');
    }
    conn.tokens -= 1;
  }

  private write(e: Omit<LogEntry, 'time'>): void {
    this.opts.log?.({ time: new Date().toISOString(), ...e });
  }
}

function info(a: ActionDef): ActionInfo {
  return { name: a.name, title: a.title, description: a.description, tier: a.tier, input: a.input };
}

function checkToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Merge the `mcatzp` entry into the app's bridge.json, keeping everything else the app wrote there. */
export async function writeBridgeEntry(bridgeFile: string, entry: BridgeEntry): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  let doc: Record<string, unknown> = {};
  try {
    doc = JSON.parse(await readFile(bridgeFile, 'utf8'));
  } catch {
    // no file yet
  }
  doc.mcatzp = entry;
  await writeFile(bridgeFile, JSON.stringify(doc, null, 2) + '\n');
}

export type { ActionInfo, AppInfo, BridgeEntry, CallResult, Platform } from '@catzoid/mcatzp-protocol';
export * from './setup.js';
