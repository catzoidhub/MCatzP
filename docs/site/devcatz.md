---
layout: ../../../layouts/Docs.astro
title: MCatzP in DevCatz
description: Let an AI assistant use DevCatz through MCatzP — what you share, what it can read, what it asks first, and how to take it back.
updated: 2026-11-05
---

[MCatzP](/docs/mcatzp) lets an AI assistant such as Claude Code or ZCode use the Catzoid apps on your computer. With it
on in DevCatz, you can ask your assistant *why does this site not start?* or *install PHP 8.4 and create a database for
this project*, and it works through DevCatz. It stays on your computer: nothing is opened to the internet, and DevCatz
only listens on a channel your own account can reach (a socket file on macOS, a named pipe on Windows).

## Turn it on

MCatzP is off until you turn it on, in **Settings → MCatzP**:

1. Turn on **Let AI assistants use DevCatz through MCatzP**.
2. Under **Clients**, press **Add** next to your assistant. The program and these entries are **Shared with Catzoid
   apps**: add it once, from any of them. If MCatzP is not on your computer yet, **Install MCatzP** comes first.
3. Under **Access**, choose what to share. No site is shared at first.
4. Start a new session in your assistant, so it picks up the tools.

The first time an assistant connects, DevCatz asks **Let &lt;client&gt; use DevCatz?**. The name is what the assistant says
about itself: if you did not just start it, choose **Don't Allow**. Approval is per app: **Approved in** shows where each
assistant is approved, and approving it in DevCatz does not approve it anywhere else.

## What you share

| In Access | What it does |
|---|---|
| **All sites, including new ones** | Every site is shared, also what you add later. Without it, you tick sites one by one. |
| **Services and runtimes** | On at first. Which databases, search engines and other services exist and whether they run; no passwords or keys. |
| **Messages** | Off at first. Caught mail and SMS, WhatsApp contacts and messages, requests through a public share. |
| **Let clients ask for changes** | On at first. Off: it can only read, and the tools that change things are gone. |
| **Not secret / Secret** | `.env` names you decide yourself, where DevCatz's guess by name is wrong. |

Whatever the assistant reads goes to its model provider. Logs and messages can hold personal data, so think about that
before you share them.

## What it can do without asking

Reading, inside what you share: sites and their status, logs, Git status, history and diffs, `.env` names and the values
that are not secret, Docker files, OpenAPI documents, services, databases, runtimes and their tools, what Monitoring shows,
and a screenshot of a site.

Secrets are masked by their name and shape (`password`, `api_key`, `DB_PASSWORD: x`, `"apiKey": "x"`) wherever text goes
out. A long random token under an ordinary name can still get through, which is what **Not secret / Secret** is for.

## What it asks first

Every change shows a dialog in DevCatz, built from what will really happen, not from the assistant's words. **Don't Allow**
is the default.

| What | How DevCatz asks |
|---|---|
| Link a site, change its settings, start or stop it, create a database, install a service or a runtime, commit, push, Docker, write to `.env`, show one secret | One dialog. A few low-risk ones, such as start and stop, can be allowed until the assistant disconnects |
| What leaves this computer: a public share, a WhatsApp message, sending through a gateway, a pull request | One dialog showing who and what, every time |
| Remove a site, discard changes, reset, squash, amend, force push, delete a branch, uninstall a service, delete an index or a bucket, wipe a database | **You type a name**, every time, checked in DevCatz itself as well |

A question you do not answer lapses and counts as a refusal. If the assistant gives up, the question closes. After you
allow something, DevCatz opens the page of what you allowed. Long work goes on in the window as if you had started it,
and the assistant can stop what it started.

## What stays with you

An assistant never sets a password or a key, and never sees one by itself: a secret's value goes out one at a time, after
you allow it. It cannot sign in to a Git host, tunnel or mail account, link a WhatsApp phone (the QR stays in DevCatz), trust
the certificate, change these settings, install a DevCatz update, uninstall DevCatz, send a report, or approve itself.

## See what it did, and take it back

Under **Activity** every call is listed with how it ended: names and outcomes, never what was read. Filter by **Changes**
or **Problems**.

**Revoke** under **Clients** forgets an assistant in DevCatz and closes every connection; it has to ask again next time.
Turning the switch off closes the channel altogether.

## Honest limits

Reading has no dialog, and the channel is open to any program running under your own account. A program pretending to be
an approved assistant could read what you share, and ask for changes, which you still confirm.

DevCatz runs your projects, so some changes run code: a site's dev command, installing dependencies, a framework's task,
`docker compose`, a build. The dialog shows what will run. Read it before you allow it, above all a dev command the
assistant wrote, and share only what you need.
