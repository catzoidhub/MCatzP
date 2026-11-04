---
layout: ../../../layouts/Docs.astro
title: MCatzP in DialCatz
description: Let an AI assistant use DialCatz through MCatzP — what you share, what it can read, what it asks first, and how to take it back.
updated: 2026-11-04
---

[MCatzP](/docs/mcatzp) lets an AI assistant such as Claude Code or ZCode use the Catzoid apps on your computer. With it
on in DialCatz, you can ask your assistant *why does this request return 422?* or *add a request for the new orders
route and send it*, and it works through DialCatz. It stays on your computer: nothing is opened to the internet, and
DialCatz only listens on a channel your own account can reach (a socket file on macOS, a named pipe on Windows).

This is not the same as [AI in DialCatz](/docs/dialcatz/ai). There DialCatz calls a model you set up. Here an assistant
you already use calls DialCatz.

## Turn it on

MCatzP is off until you turn it on, in **Settings → MCatzP**:

1. Turn on **Let AI assistants use DialCatz through MCatzP**.
2. Under **Clients**, press **Add** next to your assistant. The program and these entries are **Shared with Catzoid
   apps**: add it once, from any of them. If MCatzP is not on your computer yet, **Install MCatzP** comes first.
3. Under **Access**, choose what to share. Nothing is shared at first.
4. Start a new session in your assistant, so it picks up the tools.

The first time an assistant connects, DialCatz asks **Let &lt;client&gt; use DialCatz?**. The name is what the assistant
says about itself: if you did not just start it, choose **Don't Allow**.

## What you share

| In Access | What it does |
|---|---|
| **All workspaces, including new ones** | Every workspace is shared, also the ones you add later. Without it, you tick them one by one. |
| **Variable values** | On at first. Off: the assistant only sees the names of variables. Secret ones stay masked either way. |
| **History and responses** | On at first. Off: it only sees saved requests, and the tools that read history and responses are gone. |
| **Git repositories** | Off at first. On: every repository in the Git section, whichever workspaces you share. |
| **Let clients ask for changes** | On at first. Off: it can only read, and the tools that send or change things are gone. |

Whatever the assistant reads goes to its model provider. A response can hold personal data, so think about that before
you share responses.

## What it can do without asking

Reading, inside what you share: workspaces, collections, requests, environments, open tabs and their last response,
History, team sync state and who is online, what can be imported from DevCatz and DoCatz, and Git.

Secrets are masked in two ways. Every value DialCatz knows is secret (secret variables, saved logins) is taken out wherever
it appears, as it is, URL-encoded or in base64, so a server echoing your token back does not give it away. And what looks
like a secret by its name or shape goes too (`password`, `api_key`, a JWT), also in bodies such as
`{ "name": "password", "value": "…" }`. A long random token under an ordinary name that DialCatz does not know as secret
can still get through.

## What it asks first

Every change shows a dialog in DialCatz, built from what will really happen, not from the assistant's words. **Don't Allow**
is the default.

| What | How DialCatz asks |
|---|---|
| **Send a request, run a collection**, use a WebSocket | One dialog, every time, saying where it really goes and which secrets it carries |
| **Write a script** | One dialog, every time, showing the script: a script runs with all your variables, secret ones too |
| Import, copy a collection, change settings, commit, push, pull, team sync, and more | One dialog |
| Create or change requests, folders, collections and variables, stage files, favorites and groups | One dialog, which can allow this kind of action until the assistant disconnects |
| Delete a request, folder, collection, environment or workspace, clear History, leave a team server, remove a secret variable | **You type a name**, every time |
| Discard changes, reset, squash, amend, force push, delete a branch, tag or stash, restore a file, remove a worktree | **You type a name**, every time |

A question you do not answer lapses and counts as a refusal. If the assistant gives up, the question closes, and a request
it was waiting for stops. Only that one: never something you are sending yourself.

Opening or importing a file, and exporting, use DialCatz's own file dialog, so you choose the file. The assistant never
gets a path. Requests sent this way show up in a tab and in History, as if you sent them.

## What stays with you

An assistant cannot read or set a secret. A login or a secret-looking header it writes must be a `{{variable}}`, and it can
create a secret variable only without a value: you fill that in. It cannot take the secret mark off. Its exports never hold
secret values.

It cannot connect to a team server, add a Git account or SSH key, use a Postman API key, change the AI connection or these
settings, send a bug report, install an update, uninstall DialCatz, or approve itself.

## See what it did, and take it back

Under **Activity** every call is listed with how it ended: names and outcomes, never what was read. Filter by **Changes**
or **Problems**.

**Revoke** under **Clients** forgets an assistant and closes every connection; it has to ask again next time. Turning
the switch off closes the channel altogether.

## Honest limits

Reading has no dialog, and the channel is open to any program running under your own account. A program pretending to be
an approved assistant could read what you share, and ask for changes, which you still confirm.

A script an assistant wrote could hand a secret out in a disguised form, which masking cannot recognize. Read a script
before you allow it, and share only what you need.
