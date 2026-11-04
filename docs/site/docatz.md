---
layout: ../../../layouts/Docs.astro
title: MCatzP in DoCatz
description: Let an AI assistant use DoCatz through MCatzP — what you share, what it can read, what it asks first, and how to take it back.
updated: 2026-11-04
---

[MCatzP](/docs/mcatzp) lets an AI assistant such as Claude Code or ZCode use the Catzoid apps on your computer. With it
on in DoCatz, you can ask your assistant *why does the web container keep restarting?* or *pull the new images and bring
this project up again*, and it works through DoCatz. It stays on your computer: nothing is opened to the internet, and
DoCatz only listens on a channel your own account can reach (a socket file on macOS, a named pipe on Windows).

## Turn it on

MCatzP is off until you turn it on, in **Settings → MCatzP**:

1. Turn on **Let AI assistants use DoCatz through MCatzP**.
2. Under **Clients**, press **Add** next to your assistant. The program and these entries are **Shared with Catzoid
   apps**: add it once, from any of them. If MCatzP is not on your computer yet, **Install MCatzP** comes first.
3. Under **Access**, choose what to share. Nothing is shared at first.
4. Start a new session in your assistant, so it picks up the tools.

The first time an assistant connects, DoCatz asks **Let &lt;client&gt; use DoCatz?**. The name is what the assistant says
about itself: if you did not just start it, choose **Don't Allow**.

## What you share

| In Access | What it does |
|---|---|
| **All compose projects and loose containers, including new ones** | Everything is shared, also what you add later. Without it, you tick projects one by one. |
| **Logs** | On at first. Container, build and engine logs. Off: the tools that read them are gone. |
| **Images, volumes, networks and builds** | On at first. They belong to the engine, not to one project: names, sizes and what uses them, never what is inside a volume. Off: those tools are gone. |
| **Let clients ask for changes** | On at first. Off: it can only read, and the tools that change things are gone. |
| **Values that are not secret** | On at first. Off: the assistant only sees the names in a project's environment. |
| **Not secret / Secret** | Names you decide yourself, where DoCatz's guess by name is wrong. |

Whatever the assistant reads goes to its model provider. A log can hold personal data, so think about that before you
share logs.

DevCatz's own services run on this engine too, but they stay DevCatz's: an assistant can see them here, and manages them
through DevCatz.

## What it can do without asking

Reading, inside what you share: the engine and its log, disk use, projects and their compose files, containers with their
logs, statistics and files, what Monitoring shows right now, builds, images, volumes, networks, domains, databases found
in your containers, and what could be moved from another Docker. The charts of the last ten minutes live in the window, so
an assistant only sees the present.

Secrets are masked in two ways. Every value DoCatz knows is secret (from every container's environment, every project's
environment file and database passwords, shared or not) is taken out wherever it appears, as it is, URL-encoded or in
base64. And what looks like a secret by its name or shape goes too (`password`, `api_key`, a JWT, `Bearer …`). A long
random token under an ordinary name that DoCatz does not know as secret can still get through.

## What it asks first

Every change shows a dialog in DoCatz, built from what will really happen, not from the assistant's words. **Don't Allow**
is the default.

| What | How DoCatz asks |
|---|---|
| **Up, build, pull**, edit a compose file or an environment, save a file in a container, show one secret, the engine, domains, certificates, the Docker context, moving from another Docker, installing a Catzoid app, and more | One dialog, every time |
| Start, stop, restart or pause a container, stop or restart a project, favorites and groups, the theme, and more | One dialog, which can allow this kind of action until the assistant disconnects |
| Compose down, remove a container, image, volume or network, prune, remove an environment or one of its variables | **You type a name**, every time |
| **Reset the engine**: every container, image and volume, in every project | **You type `reset`**, every time, and only with everything shared |

A question you do not answer lapses and counts as a refusal. If the assistant gives up, the question closes, and work it
started stops. After you allow something, DoCatz opens the page of what you allowed. Long work goes on in the window as if
you had started it, and the assistant can stop what it started.

## What stays with you

An assistant never sets a secret and never sees one by itself: a secret's value goes out one at a time, after you allow
it, and the dialog says so. A masked value it sends back is refused, so it cannot overwrite the real one. It edits a compose
file one piece at a time, and it never names a path on this computer.

It has no terminal and no free command: it cannot run anything inside a container or on this computer. It cannot change the
AI connection or these settings, install an update, uninstall DoCatz, or approve itself.

## See what it did, and take it back

Under **Activity** every call is listed with how it ended: names and outcomes, never what was read. Filter by **Changes**
or **Problems**.

**Revoke** under **Clients** forgets an assistant and closes every connection; it has to ask again next time. Turning
the switch off closes the channel altogether.

## Honest limits

Reading has no dialog, and the channel is open to any program running under your own account. A program pretending to be
an approved assistant could read what you share, and ask for changes, which you still confirm.

`compose up` runs what a compose file says, with your project's secrets inside its containers, and a build runs what a
Dockerfile says. Read a change to one before you allow it, and share only what you need.

Images, volumes, networks and builds, and the engine itself, are the whole engine's, not one project's: sharing one project and
those resources shows a little about the others.
