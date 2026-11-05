# Security

MCatzP stands between an AI assistant and the apps on your computer, where it can reach your sites, databases, requests and
containers. So a hole in it matters, and we want to hear about it.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately instead:

1. Open the repository's **Security** tab → **Report a vulnerability**
   ([direct link](https://github.com/catzoidhub/MCatzP/security/advisories/new)). Only the maintainers see it.
2. Say what is affected, how to reproduce it, and what an attacker could do with it. A proof of concept helps.

Security reports are read before anything else, as soon as a maintainer can — there is no fixed response time yet.
Together we agree on a fix and when to publish it; you are credited in the advisory and the release notes unless you
would rather not be.

## What is in scope

- The `mcatzp` program, and `@catzoid/mcatzp-host`, the part the apps embed: the channel, the token, pairing, the tiers and
  the activity log.
- Anything that makes a change run **without the confirmation in the app**, or a destructive action without its typed name.
  The few tools that cancel or stop work, or dismiss a notice, are meant to run at once; they are listed in the
  [tool reference](https://catzoid.com/docs/mcatzp/tools).
- Anything that reads or changes **more than what is shared** in Settings → MCatzP.
- A secret that gets past the masking, or text from a site, database, request or log that makes MCatzP or an app do
  something by itself.
- A channel that can be reached from another computer or another user's account, or a network call the `mcatzp` program
  makes on its own.
- Installing and updating: anything that gets a download past its SHA-256 check.

A bug in how one of the apps answers is welcome here too; if it belongs in that app's repository, we will move it.

## What is out of scope

These are known limits, written down in [Honest limits](https://catzoid.com/docs/mcatzp#honest-limits):

- The name a client gives at pairing is its own claim.
- The token can be read by any program running under your own account, which can then read what you share and ask for
  changes. Those changes still wait for your confirmation in the app.
- What an AI client or its model provider does with what it read.

Also out of scope: problems that need someone who already controls your computer or your user account, and vulnerabilities
in AI clients or other third-party software (report those upstream — we are happy to help).

## Supported versions

Only the **latest release** of MCatzP gets security fixes.
