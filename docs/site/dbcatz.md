---
layout: ../../../layouts/Docs.astro
title: MCatzP in DBCatz
description: Let an AI assistant use DBCatz through MCatzP — what you share, what it can read, what it asks first, and how to take it back.
updated: 2026-11-04
---

[MCatzP](/docs/mcatzp) lets an AI assistant such as Claude Code or ZCode use the Catzoid apps on your computer. With it
on in DBCatz, you can ask your assistant *which tables have an email column?* or *add an index on orders.created_at*,
and it works through DBCatz. It stays on your computer: nothing is opened to the internet, and DBCatz only listens on a
channel your own account can reach (a socket file on macOS, a named pipe on Windows).

This is not the same as [AI in DBCatz](/docs/dbcatz/ai). There DBCatz calls a model you set up. Here an assistant you
already use calls DBCatz.

## Turn it on

MCatzP is off until you turn it on, in **Settings → MCatzP**:

1. Turn on **Let AI assistants use DBCatz through MCatzP**.
2. Under **Clients**, press **Add** next to your assistant. The program and these entries are **Shared with Catzoid
   apps**: add it once, from any of them. If MCatzP is not on your computer yet, **Install MCatzP** comes first.
3. Under **Access**, choose what to share. Nothing is shared at first.
4. Start a new session in your assistant, so it picks up the tools.

The first time an assistant connects, DBCatz asks **Let &lt;client&gt; use DBCatz?**. The name is what the assistant says
about itself: if you did not just start it, choose **Don't Allow**.

## What you share

| In Access | What it does |
|---|---|
| **All connections, including new ones, except Production** | Every connection is shared, also the ones you add later. Without it, you tick them one by one. |
| A ticked connection | Shared. This is the only way to share a [Production](/docs/dbcatz/safety) connection. |
| **Rows, query results and keys** | On at first. Off: the assistant only sees the structure (databases, tables, columns, indexes). |
| **Let clients ask for changes** | On at first. Off: it can only read, and the tools that change things are gone. |

A connection opened from a URL for this session is never shared. Whatever the assistant reads goes to its model
provider, so think about personal data before you share rows.

## What it can do without asking

Reading, inside what you share: connections, databases, tables, structure, rows, keys, saved queries, jobs, the
[Logs](/docs/dbcatz/queries) of a connection and the query history.

Queries through `run_read_query` must only read, and are checked statement by statement. On MySQL, MariaDB and PostgreSQL
they also run on a session that is read-only on the server. Something that writes is refused, and named in the answer.

Values under a column, field or key whose name looks secret (`password`, `api_token`, `secret` …) come back as `•••`, and
other secrets in text are masked as they are for [AI in DBCatz](/docs/dbcatz/ai). An alias or a function around such a column is masked too. This
goes by the name, so it can miss a secret kept under an ordinary name. Connection passwords are never read at all.

## What it asks first

Every change shows a dialog in DBCatz, built from what will really happen, not from the assistant's words. **Don't Allow**
is the default.

| What | How DBCatz asks |
|---|---|
| Insert or update a row, create or change a table, set a key, import, export, back up, show something in the window | One dialog |
| Save a query, favorites, groups, stars, disconnect, open DevCatz or DoCatz | One dialog, which can allow this kind of action until the assistant disconnects |
| Delete rows, drop or empty tables, drop a database, delete keys, flush, delete a saved connection | **You type a name**, every time |
| A query that writes, on a Production connection or when it removes data | **You type the connection's name** |
| A table change that loses data | **You type the column, index or table name**, as in the [Structure tab](/docs/dbcatz/tables) |

A question you do not answer lapses and counts as a refusal. If the assistant gives up, the question closes.

The [safety modes](/docs/dbcatz/safety) still hold: a **Read-only** connection refuses every write, whoever asks.

Export, backup and import open DBCatz's own file dialog, so you choose the file. The assistant never gets a path.

## What stays with you

An assistant cannot read or set a password, edit a connection (that could lift its Read-only mode), set up SSH, AWS or
Vault, change these settings, or approve itself. It can add a plain connection, in Normal mode and without a password; you
add the password on the connection.

## See what it did, and take it back

Under **Activity** every call is listed with how it ended: names and outcomes, never what was read. Filter by **Changes**
or **Problems**.

**Revoke** under **Clients** forgets an assistant and closes every connection; it has to ask again next time. Turning
the switch off closes the channel altogether.

## An honest limit

Reading has no dialog, and the channel is open to any program running under your own account. A program pretending to be
an approved assistant could read what you share, and ask for changes, which you still confirm. So share what you need, and
leave Production out unless you are working on it.

Every tool is listed in the [tool reference](/docs/mcatzp#dbcatz-tools).
