<p align="center"><img src="resources/icon.png" width="128" height="128" alt="MCatzP"></p>

<h1 align="center">MCatzP</h1>

<p align="center">One MCP server for every Catzoid app — DevCatz, DBCatz, DialCatz and DoCatz.<br>
<em>The MCP with the cats inside. One connection, every cat. You hold the keys.</em></p>

<p align="center"><a href="https://catzoid.com/mcatzp">catzoid.com/mcatzp</a></p>

> Works with DevCatz, DBCatz, DialCatz and DoCatz **1.1.0 or later**; an older app tells you to update it.

## Install

Settings → MCatzP in any of the four apps installs it and adds it to your AI client. Or:

```bash
brew install catzoidhub/catz/mcatzp
```

```bash
claude mcp add mcatzp -- npx -y mcatzp
```

Binaries for macOS (Apple silicon, Intel; signed and notarized) and Windows (x64, not signed) are on
[catzoid.com/mcatzp](https://catzoid.com/mcatzp).

MCatzP lets an AI assistant — Claude Code, ZCode, Claude Desktop, Cursor, Gemini CLI, Codex CLI or any client that
speaks MCP — use the Catzoid apps on your computer. It runs locally over stdio; each app decides what it shares, and
every change is confirmed in the app, not in the chat.

## How it works

MCatzP finds the installed apps through their `bridge.json`, connects to a local channel each app opens only while
its MCatzP switch is on, and offers the app's actions as tools (`dbcatz_list_tables`, `devcatz_start_site` …). Read
actions run at once inside what you shared; changes ask in the app; destructive actions make you type the name. See
[docs/protocol.md](docs/protocol.md).

## Repository

| Package | What |
| --- | --- |
| `packages/server` | `mcatzp`, the MCP server (npm and a single binary per platform) |
| `packages/host` | `@catzoid/mcatzp-host`, what the apps embed: channel, token, pairing, tiers, log |
| `packages/protocol` | `@catzoid/mcatzp-protocol`, the shared types |
| `packages/fakecat` | a stand-in app for testing |

```bash
bun install
bun test
bun run typecheck
bun run build
```

## Licence

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The names and the cat logos are not covered by the licence.
Copyright © 2026 Mahryan Rakhmatullah.
