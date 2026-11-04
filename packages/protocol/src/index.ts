// The wire protocol between MCatzP and a Catzoid app (docs/protocol.md is the human version of this file).
// JSON-RPC 2.0, one UTF-8 message per line, over a Unix socket (macOS) or a named pipe (Windows).

export const PROTOCOL_VERSION = 1;

/** The longest line either side accepts; anything longer closes the connection. */
export const MAX_LINE_BYTES = 1024 * 1024;

/** The Catzoid apps MCatzP looks for, with their data folder names. */
export const KNOWN_APPS = [
  { id: 'devcatz', name: 'DevCatz' },
  { id: 'dbcatz', name: 'DBCatz' },
  { id: 'dialcatz', name: 'DialCatz' },
  { id: 'docatz', name: 'DoCatz' },
] as const;

export type Tier = 'read' | 'change' | 'destructive';
export type Platform = 'darwin' | 'win32';

/** The `mcatzp` entry an app writes into its bridge.json. Absent = the app is older than 1.1.0. */
export interface BridgeEntry {
  protocol: number;
  /** false while the MCatzP switch in the app is off; then no channel exists. */
  enabled: boolean;
  /** true when `enabled` is false only because the app quit: its switch is still on. */
  closed?: boolean;
  /** Unix socket path or `\\.\pipe\…` name; only while enabled. */
  channel?: string;
  /** File holding the session token (0600); only while enabled. */
  tokenFile?: string;
  /** The clients approved in this app, by name, for the other Catzoid apps to show; only while enabled. */
  approved?: string[];
  app: AppInfo;
}

export interface AppInfo {
  id: string;
  name: string;
  version: string;
}

/** A JSON Schema object (draft 2020-12 subset) describing an action's arguments. */
export type JsonSchema = Record<string, unknown>;

/** What an app tells MCatzP about one action; MCatzP turns it into the tool `<app>_<name>`. */
export interface ActionInfo {
  /** snake_case, `[a-z][a-z0-9_]*`. */
  name: string;
  title: string;
  description: string;
  tier: Tier;
  input: JsonSchema;
}

// ---- methods (MCatzP → app) ----

export interface HelloParams {
  protocol: number;
  token: string;
  /** The MCP client as it named itself (MCP clientInfo) — self-reported, a label for pairing, not proof. */
  client: { name: string; version?: string };
  server: { name: 'mcatzp'; version: string };
}

export interface HelloResult {
  protocol: number;
  app: AppInfo & { platform: Platform };
}

export interface ListActionsResult {
  actions: ActionInfo[];
}

export interface CallParams {
  name: string;
  args: Record<string, unknown>;
  /** MCatzP's client asked for progress: the app may send `actions.progress` with this id while the call runs. */
  progressId?: number;
}

/** Notification app → MCatzP, for a call that carried `progressId`. */
export interface ProgressParams {
  progressId: number;
  /** One line for the user, e.g. "Downloading 41% (143 of 348 MB)". */
  message: string;
  /** How far the whole action is, 0–100, when the app can tell; never goes down. */
  percent?: number;
}

export interface CallResult {
  /** Plain text for the assistant. Data the app returns is data, never instructions. */
  text: string;
  /** Optional structured copy of the same result. */
  data?: unknown;
  /** Optional picture for clients that can look at one (a screenshot), base64. */
  image?: { mimeType: string; data: string };
}

export const Methods = {
  hello: 'hello',
  listActions: 'actions.list',
  call: 'actions.call',
  /** Notification app → MCatzP: the action list or scopes changed. */
  actionsChanged: 'actions.changed',
  /** Notification app → MCatzP: how a running call is doing. */
  actionsProgress: 'actions.progress',
  /** Notification MCatzP → app: the client gave up on a call (`callId` = the id of its actions.call). */
  actionsCancel: 'actions.cancel',
} as const;

// ---- errors ----

export const ErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unauthorized: -32001,
  pairingDenied: -32002,
  outOfScope: -32003,
  declined: -32004,
  rateLimited: -32005,
  unknownAction: -32006,
  protocolMismatch: -32008,
  actionFailed: -32009,
  timeout: -32010,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

// ---- JSON-RPC framing ----

export interface RpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type RpcMessage = RpcRequest | RpcResponse;

export const ACTION_NAME = /^[a-z][a-z0-9_]*$/;

/** Splits a byte stream into lines; refuses lines over MAX_LINE_BYTES. */
export class LineReader {
  private buf = '';
  constructor(
    private readonly onLine: (line: string) => void,
    private readonly onOverflow: () => void,
  ) {}

  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line) this.onLine(line);
    }
    if (Buffer.byteLength(this.buf) > MAX_LINE_BYTES) {
      this.buf = '';
      this.onOverflow();
    }
  }
}

export function encode(msg: RpcMessage): string {
  return JSON.stringify(msg) + '\n';
}
