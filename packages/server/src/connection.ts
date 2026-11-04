// One connection from MCatzP to one app's channel: hello with the token, then requests.

import { readFile } from 'node:fs/promises';
import net from 'node:net';
import {
  type BridgeEntry,
  type CallResult,
  encode,
  ErrorCodes,
  type HelloResult,
  LineReader,
  type ListActionsResult,
  Methods,
  PROTOCOL_VERSION,
  type ProgressParams,
  ProtocolError,
  type RpcMessage,
} from '@catzoid/mcatzp-protocol';
import { VERSION } from './version.js';

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
  timer: NodeJS.Timeout;
  onProgress?: (p: { message: string; percent?: number }) => void;
  /** Runs out from the last sign of life, so a long action that reports progress is not cut off. */
  restart?: () => NodeJS.Timeout;
}

/** How long a call may wait — a change waits for the user's click in the app. */
export const CALL_TIMEOUT_MS = 10 * 60_000;
/** Pairing waits for the user too. */
export const HELLO_TIMEOUT_MS = 3 * 60_000;

export class AppConnection {
  private socket?: net.Socket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  closed = false;
  hello?: HelloResult;
  private actions?: Promise<ListActionsResult>;

  constructor(
    readonly entry: BridgeEntry,
    private readonly onChanged: () => void,
  ) {}

  /** Connects and says hello; resolves once the app accepted this client (pairing may ask the user first). */
  async open(client: { name: string; version?: string }): Promise<HelloResult> {
    const token = (await readFile(this.entry.tokenFile!, 'utf8')).trim();
    const socket = net.connect(this.entry.channel!);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.setEncoding('utf8');
    const reader = new LineReader(
      (line) => this.onLine(line),
      () => socket.destroy(),
    );
    socket.on('data', (d: string) => reader.push(d));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.fail(new ProtocolError(ErrorCodes.internal, `${this.entry.app.name} closed the connection.`)));
    this.hello = (await this.request(
      Methods.hello,
      { protocol: PROTOCOL_VERSION, token, client, server: { name: 'mcatzp', version: VERSION } },
      HELLO_TIMEOUT_MS,
    )) as HelloResult;
    return this.hello;
  }

  listActions(): Promise<ListActionsResult> {
    this.actions ??= this.request(Methods.listActions, {}, 30_000) as Promise<ListActionsResult>;
    this.actions.catch(() => (this.actions = undefined));
    return this.actions;
  }

  call(name: string, args: Record<string, unknown>, onProgress?: (p: { message: string; percent?: number }) => void, signal?: AbortSignal): Promise<CallResult> {
    const callId = this.nextId;
    const done = this.request(Methods.call, { name, args }, CALL_TIMEOUT_MS, onProgress) as Promise<CallResult>;
    if (signal) {
      const cancel = () => {
        if (!this.closed) this.socket?.write(encode({ jsonrpc: '2.0', method: Methods.actionsCancel, params: { callId } }));
      };
      if (signal.aborted) cancel();
      else {
        signal.addEventListener('abort', cancel, { once: true });
        void done.finally(() => signal.removeEventListener('abort', cancel)).catch(() => {});
      }
    }
    return done;
  }

  close(): void {
    this.socket?.destroy();
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs: number, onProgress?: Pending['onProgress']): Promise<unknown> {
    if (this.closed || !this.socket) return Promise.reject(new ProtocolError(ErrorCodes.internal, 'Not connected.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const restart = () =>
        setTimeout(() => {
          this.pending.delete(id);
          reject(new ProtocolError(ErrorCodes.timeout, `${this.entry.app.name} did not answer in time.`));
        }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer: restart(), onProgress, restart });
      this.socket!.write(encode({ jsonrpc: '2.0', id, method, params: onProgress ? { ...params, progressId: id } : params }));
    });
  }

  private onLine(line: string): void {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if ('method' in msg) {
      if (msg.method === Methods.actionsChanged) {
        this.actions = undefined;
        this.onChanged();
      } else if (msg.method === Methods.actionsProgress) {
        const x = msg.params as ProgressParams;
        const p = this.pending.get(x?.progressId);
        if (p?.onProgress) {
          clearTimeout(p.timer);
          p.timer = p.restart!();
          p.onProgress({ message: String(x.message).slice(0, 300), ...(typeof x.percent === 'number' ? { percent: x.percent } : {}) });
        }
      }
      return;
    }
    const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
    if (!p) return;
    this.pending.delete(msg.id as number);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new ProtocolError(msg.error.code, msg.error.message, msg.error.data));
    else p.resolve(msg.result);
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.onChanged();
  }
}
