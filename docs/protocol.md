# MCatzP protocol, version 1

How MCatzP talks to a Catzoid app (DevCatz, DBCatz, DialCatz, DoCatz). An app implements the app side with
`@catzoid/mcatzp-host`; the types are in `@catzoid/mcatzp-protocol` (`packages/protocol/src/index.ts`), which is the
source of truth when this page and the code disagree.

```
MCP client ──stdio──▶ mcatzp ──socket / named pipe, JSON-RPC 2.0──▶ the app (does the work, asks the user)
```

MCatzP never reads an app's data, Keychain / Credential Manager or files. It only forwards; the app applies its own
rules and shows its own dialogs.

## 1. Discovery: bridge.json

Each app already keeps `bridge.json` in its data folder:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/<App>/bridge.json` |
| Windows | `%APPDATA%\<App>\bridge.json` |

From 1.1.0 it carries an `mcatzp` entry next to whatever else the app writes there:

```json
{
  "mcatzp": {
    "protocol": 1,
    "enabled": true,
    "channel": "/Users/me/Library/Application Support/DBCatz/mcatzp.sock",
    "tokenFile": "/Users/me/Library/Application Support/DBCatz/mcatzp.token",
    "app": { "id": "dbcatz", "name": "DBCatz", "version": "1.1.0" }
  }
}
```

| What MCatzP sees | Meaning | What the user is told |
| --- | --- | --- |
| no data folder | not installed | "DBCatz is not installed." |
| folder, no `mcatzp` entry, or another `protocol` | older than 1.1.0 | "update it to 1.1.0 or later" |
| `enabled: false`, `closed: true` | the app quit with its switch on | "open it to use its tools" |
| `enabled: false` | the MCatzP switch is off, or an app that does not write `closed` quit | "open it and check Settings → MCatzP" |
| `enabled: true` + `channel` + `tokenFile` | reachable | tools offered |

`channel` and `tokenFile` exist only while the switch is on. MCatzP re-reads the files every few seconds and tells
the MCP client when the list of tools changed.

## 2. The channel

- **macOS:** a Unix socket `<data>/mcatzp.sock`, mode `0600`, created under umask `0177`.
- **Windows:** a named pipe `\\.\pipe\catzoid-<app>-<random>`, created with Windows' default pipe DACL (only the
  creator, Administrators and SYSTEM can write). Never a TCP port, on any platform.
- **Token:** 32 random bytes as hex in `<data>/mcatzp.token` (`0600`), new every time the switch goes on or the app
  starts; deleted with the socket when it goes off.
- Open only while the app's MCatzP switch is on.

## 3. Framing

JSON-RPC 2.0, one UTF-8 JSON object per line (`\n`), as MCP's own stdio transport. A line longer than 1 MiB closes the
connection. Requests carry an `id`; notifications do not.

## 4. Methods

### `hello` (MCatzP → app, first)

```json
{ "jsonrpc": "2.0", "id": 1, "method": "hello",
  "params": { "protocol": 1, "token": "<hex>", "client": { "name": "Claude Code", "version": "2.1.0" },
              "server": { "name": "mcatzp", "version": "0.1.0" } } }
```

`client` is the MCP client as it named itself (`clientInfo`). The app checks the token (constant time) and the protocol,
then, if this client name is not paired yet, asks the user to approve it by name. The answer waits for the user (MCatzP
waits up to 3 minutes; its tool list updates by itself once the user answers).

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "protocol": 1,
  "app": { "id": "dbcatz", "name": "DBCatz", "version": "1.1.0", "platform": "darwin" } } }
```

Every other method before a successful `hello` is refused with `unauthorized`.

### `actions.list`

```json
{ "jsonrpc": "2.0", "id": 2, "method": "actions.list" }
→ { "result": { "actions": [
    { "name": "list_tables", "title": "List tables", "description": "…", "tier": "read",
      "input": { "type": "object", "properties": { "connection": { "type": "string" } }, "required": ["connection"] } }
  ] } }
```

Only the actions that exist on this platform. `name` is snake_case (`[a-z][a-z0-9_]*`); MCatzP offers it as the MCP
tool `<app id>_<name>` (`dbcatz_list_tables`), with `readOnlyHint` for read and `destructiveHint` for destructive.
`input` is a JSON Schema the app validates every call against.

### `actions.call`

```json
{ "jsonrpc": "2.0", "id": 3, "method": "actions.call",
  "params": { "name": "rename_toy", "args": { "id": "ball", "name": "Jingle" } } }
→ { "result": { "text": "Renamed Bell ball to Jingle.", "data": { "…": "…" } } }
```

`text` goes to the assistant; `data` (an object) is its structured copy. What an action returns is data — rows, logs,
responses — never instructions. The order of checks in the app:

1. the action exists here → else `unknownAction`
2. the arguments match `input` → else `invalidParams`
3. it is inside what the user shared (Settings → MCatzP) → else `outOfScope`
4. **tier** — `read`: runs at once · `change`: the in-app dialog, built from the real arguments, may offer "allow
   for this session" for low-risk actions (until the app quits or this connection closes; never "always") ·
   `destructive`: the dialog asks the user to type the name, every time → `declined` if the user says no
5. run → `actionFailed` with the app's message if it throws

Calls may wait for the user: MCatzP waits up to 10 minutes.

### `actions.progress` (notification, app → MCatzP)

When an MCP client asks for progress, MCatzP adds `progressId` to its `actions.call`. While that call runs, the app may
send `{"progressId": 7, "message": "Downloading 41% (143 of 348 MB)", "percent": 22}`; `percent` is the whole action,
0–100, and never goes down. MCatzP passes it on as MCP `notifications/progress`, and each one restarts its wait for the
call. An app that sends none is fine. A client's own wait may be shorter than the action: an app answers before about a
minute even if the work goes on (the answer says how to follow it).

### `actions.cancel` (notification, MCatzP → app)

`{"callId": 7}`, the id of an `actions.call`: the client gave up on that call (MCP `notifications/cancelled`). A question
still open for it goes away and it never runs; work it started stops if the action can stop it. The same question goes
away when the connection ends, but work already allowed goes on.

### `actions.changed` (notification, app → MCatzP)

Sent when the action list or the scopes change. MCatzP drops its cached list and tells the MCP client
(`notifications/tools/list_changed`).

## 5. Errors

| Code | Name | When |
| --- | --- | --- |
| -32700 | parseError | the line is not JSON |
| -32601 | methodNotFound | unknown method |
| -32602 | invalidParams | arguments do not match the action's schema; no client name |
| -32603 | internal | anything unexpected |
| -32001 | unauthorized | no `hello` yet, or a wrong / missing token |
| -32002 | pairingDenied | the user did not approve this client |
| -32003 | outOfScope | not shared with MCatzP in the app's settings |
| -32004 | declined | the user said no in the dialog |
| -32005 | rateLimited | too many calls (default 10 / s, burst 20, per connection) |
| -32006 | unknownAction | no such action on this platform |
| -32008 | protocolMismatch | another protocol version; `data.protocol` says which one the app speaks |
| -32009 | actionFailed | the action ran and failed |
| -32010 | timeout | (MCatzP side) the app did not answer in time |

## 6. Activity log

The host reports every request to the app (`log` option): time, client, method, action, tier, outcome (`ok`,
`refused`, `declined`, `failed`) and reason. The app shows it in Settings → MCatzP.

## 7. What this does and does not protect

- Other users on the computer cannot reach the channel (socket `0600` / the pipe's default DACL) or read the token.
- **A process running as the same user can read the token file**, and a client's name at pairing is self-reported.
  So pairing and the token filter callers; the **in-app dialog is the real gate for change and destructive actions**.
  A read action inside the shared scopes runs without a dialog — keep the scopes narrow (production connections and
  secrets are never shared until the user shares them).
- Deep links (`dbcatz://…`) stay for open / show only; no action can be triggered through them.

## 8. Trying it without a real app

`packages/fakecat` is a stand-in app with one action per tier and its dialogs in the terminal:

```bash
bun run fakecat
claude mcp add mcatzp-dev -e MCATZP_BRIDGE_PATHS=<the bridge.json it prints> -- bun <repo>/packages/server/src/index.ts
```

`MCATZP_BRIDGE_PATHS` adds bridge.json files to look at; `MCATZP_NO_DEFAULT_APPS=1` ignores the four real apps.
