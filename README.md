# CodeTeleport

**Teleport your AI coding sessions across devices.**

Push a conversation from one machine, pull it on another, resume right where you left off.

[![npm version](https://img.shields.io/npm/v/codeteleport?color=10b981&label=npm)](https://www.npmjs.com/package/codeteleport)
[![License: MIT](https://img.shields.io/badge/license-MIT-10b981)](https://github.com/nawaaz-korvol/codeteleport-cli-mcp/blob/main/LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-10b981)](https://docs.codeteleport.com/getting-started/installation/)
[![Docs](https://img.shields.io/badge/docs-docs.codeteleport.com-10b981)](https://docs.codeteleport.com)

---

## The Problem

You're deep in a Claude Code session on your work laptop — hundreds of messages, dozens of file edits, a full mental model of your codebase built up over hours. Time to head home. You close the lid, open your desktop, and that entire conversation is stuck on the other machine. The context, the file history, the tool calls, the subagent work — all of it, inaccessible.

## The Solution

```
npm install -g codeteleport
```

Teleport the session. Resume on the other machine. Full context intact.

---

## Quick Start

### 1. Install & Log in

```bash
npm install -g codeteleport
codeteleport auth login
```

### 2. Add the MCP server to Claude Code

```bash
claude mcp add codeteleport -- codeteleport-mcp
```

### 3. Teleport

Just talk to Claude Code:

> *"Push this session to the cloud"*

Switch machines, open the same project directory, and:

> *"Pull my latest session"*

Then:

> *"Resume the session"*

That's it. Your full conversation — every message, every file edit, every tool call — is back.

---

## How It Works

### Push

You're working in `~/projects/my-app` on Machine A. When you push:

1. CodeTeleport detects the Claude Code session tied to your current directory
2. It bundles everything — conversation log (JSONL), file history, subagent logs, paste cache, shell snapshots — into a compressed `.tar.gz`
3. The bundle is uploaded to secure cloud storage, tagged with the original machine and directory path

### Pull

You sit down at Machine B, `cd` into your project directory, and pull:

1. CodeTeleport downloads the bundle
2. It sees the session was rooted at `/home/nawaaz/projects/my-app` on the original machine
3. It rewrites every path in the session to match your current directory — `/home/alice/work/my-app`
4. The session is installed into `~/.claude/` linked to your current working directory

Claude Code sees it as a local session. `claude --resume <session-id>` picks up exactly where you left off.

**The key detail:** pull works from your current directory. Whatever directory you're in when you pull becomes the new root for the session. Paths are rewritten automatically — different username, different OS, different directory structure — it all just works.

---

## Session Versioning

Every push saves a new version of the session. Go down the wrong path with Claude? Realize the approach from 50 messages ago was better? Pull an earlier version and pick up from there.

```
> "Show me the versions of this session"

Session c3a05473 — 4 versions:

  v4   2 min ago      5.3 MB   (latest)
  v3   3 hours ago    4.8 MB
  v2   yesterday      3.1 MB
  v1   2 days ago     1.2 MB

> "Pull version 2"
```

Free accounts keep 2 versions per session. Pro keeps 10. Older versions rotate out automatically.

---

## MCP Tools

Seven tools available inside Claude Code:

| Tool | Description |
| --- | --- |
| `teleport_push` | Push the current session to the cloud (creates a new version) |
| `teleport_pull` | Pull a session from the cloud (optionally a specific version) |
| `teleport_list` | List cloud sessions with metadata |
| `teleport_local_list` | List all local Claude Code sessions on this machine |
| `teleport_versions` | Show version history for a session |
| `teleport_status` | Account info, plan, usage |
| `teleport_delete` | Delete a session and all its versions from the cloud |

---

## CLI

The same operations are available from the terminal:

```bash
codeteleport push              # Interactive session picker → push to cloud
codeteleport pull              # Interactive session picker → pull from cloud
codeteleport pull --version N  # Pull a specific version
codeteleport list              # List local or cloud sessions
codeteleport versions <id>     # Show version history for a session
codeteleport status            # Account info, plan, usage
codeteleport delete            # Delete a cloud session
codeteleport auth login        # Log in (GitHub OAuth or email)
```

### Example: Push

```
$ codeteleport push

Sessions for my-app (2 found):

  1)  c3a05473    3490 msgs     2 min ago   5.3 MB
  2)  16b4c4d7     847 msgs     3 hours ago 1.2 MB

Select session [1]: 1

Bundling...
Uploading...
Confirming...

Session teleported to CodeTeleport
  id      : c3a05473-9f12-4a2b-ae27-9478ab66d216
  version : 3
  size    : 5428 KB
  machine : work-laptop
```

### Example: Pull

```
$ codeteleport pull

Cloud sessions:

  1)  c3a05473  my-app  work-laptop   3490 msgs   5.3 MB

Select session [1]: 1
Downloading...
Installing...

Session pulled
  id      : c3a05473-9f12-4a2b-ae27-9478ab66d216
  version : 3
  from    : work-laptop
  to      : /home/alice/.claude/projects/-home-alice-projects-my-app

Resume with: claude --resume c3a05473-9f12-4a2b-ae27-9478ab66d216
```

---

## What Gets Teleported

| Component | Description |
| --- | --- |
| Conversation log | Every message, tool call, and response (JSONL) |
| Subagent conversations | Background agent logs |
| File history | Snapshots of files read or edited |
| Paste cache | Content pasted into the conversation |
| Shell snapshots | Terminal state during the session |

---

## Pricing

The CLI and MCP server are open source under the MIT license. Cloud sync has a free tier — no credit card required.

| | Free | Pro |
| --- | --- | --- |
| Sessions | 25 | Unlimited |
| Devices | 3 | Unlimited |
| Versions per session | 2 | 10 |
| Price | $0 | $5 / quarter or $15 / year |

[See pricing →](https://codeteleport.com/#pricing)

---

## Platform Support

| Platform | Status |
| --- | --- |
| macOS | Fully supported |
| Linux | Fully supported |
| Windows | Not yet (planned) |

---

## Links

| | |
| --- | --- |
| **Documentation** | [docs.codeteleport.com](https://docs.codeteleport.com) |
| **Dashboard** | [app.codeteleport.com](https://app.codeteleport.com) |
| **Website** | [codeteleport.com](https://codeteleport.com) |
| **npm** | [codeteleport](https://www.npmjs.com/package/codeteleport) |
| **GitHub** | [nawaaz-korvol/codeteleport-cli-mcp](https://github.com/nawaaz-korvol/codeteleport-cli-mcp) |
| **Support** | [support@codeteleport.com](mailto:support@codeteleport.com) · [GitHub Issues](https://github.com/nawaaz-korvol/codeteleport-cli-mcp/issues) |

---

## License

MIT
