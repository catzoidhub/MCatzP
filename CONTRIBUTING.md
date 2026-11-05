# Contributing to MCatzP

Thank you for wanting to help — MCatzP is made by one person, with two others helping, and every fix, idea and bug report counts. This page
says how to get a change merged without wasted work.

## Before you start

- **Small fixes** (a typo, an obvious bug, a clearer message): open a pull request straight away.
- **Anything bigger** (a new feature, a new dependency, a change in how something works): open an issue first and
  wait for a yes, so nobody builds something that will not be merged.
- **Security problems** never go in a public issue or pull request — see [`SECURITY.md`](SECURITY.md).
- Questions and where to ask them: [`SUPPORT.md`](SUPPORT.md).

## Running it from source

You need [Bun](https://bun.sh).

```sh
bun install
bun run typecheck    # must pass before a pull request
bun test             # must pass before a pull request
bun run build
bun run dev          # the MCP server from source
bun run fakecat      # a stand-in app, so you can try it without the real cats
```

The code is TypeScript, in four packages:

| Package | What |
| --- | --- |
| `packages/server` | `mcatzp`, the MCP server (npm and a single binary per platform) |
| `packages/host` | `@catzoid/mcatzp-host`, what the apps embed: channel, token, pairing, tiers, log |
| `packages/protocol` | `@catzoid/mcatzp-protocol`, the shared types |
| `packages/fakecat` | a stand-in app for testing |

How the server and the apps talk is in [`docs/protocol.md`](docs/protocol.md). The tools themselves live in each app, and
`docs/tools/` is generated from the apps' registries: please do not edit those files by hand.

## Making the change

- **Branches.** Work on a branch in your fork (`fix/…` or `feature/…`) and open the pull request against `main`.
  `main` is what the next release is built from; releases are tags (`v1.2.0`).
- **Match the code around you** — its naming, comment style and structure. No reformatting of lines you did not
  change, and no new dependency without asking first.
- **One change per pull request**, with a title that says what it does ("Fix the retry when a channel closes"). Say
  why in the description and link the issue (`Fixes #123`).
- **Keep the guards.** A change must not weaken what is shared, the confirmation in the app, the masking or the local-only
  channel without saying so plainly and agreeing it first.
- **Words people read** are English and short; the cats speak plainly and kindly.
- **Never commit secrets** — keys, tokens, passwords, real customer or company names in test data.

## Before you open the pull request

- `bun run typecheck`, `bun run build` and `bun test` pass.
- Try it from a real MCP client, or against `bun run fakecat`.

## The contributor licence agreement

The first time you open a pull request, the CLA check asks you to sign the
[contributor licence agreement](CLA.md) by leaving a comment. You keep the copyright of your work; the agreement lets
the project ship it under its licence. You sign once for all your pull requests.

## Names and logos

MCatzP's code is free software ([`LICENSE`](LICENSE)); its name, the Catzoid name and the cat logos are not
([`TRADEMARKS.md`](TRADEMARKS.md)). Please do not change them in a pull request — and a fork that is shared with
others needs its own name and icon.
