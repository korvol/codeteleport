# CodeTeleport

**Teleport your AI coding sessions across devices.**

Push a conversation from one machine, pull it on another, resume right where you left off. Works with Claude Code, Codex, and Antigravity.

[![npm version](https://img.shields.io/npm/v/codeteleport?color=10b981&label=npm)](https://www.npmjs.com/package/codeteleport)
[![License: MIT](https://img.shields.io/badge/license-MIT-10b981)](https://github.com/korvol/codeteleport/blob/main/LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-10b981)](https://docs.codeteleport.com/getting-started/installation/)
[![Docs](https://img.shields.io/badge/docs-docs.codeteleport.com-10b981)](https://docs.codeteleport.com)

---

## The Problem

You're deep in an AI coding session on your work laptop — hundreds of messages, dozens of file edits, a full mental model of your codebase built up over hours. Time to head home. You close the lid, open your desktop, and that entire conversation is stuck on the other machine. The context, the file history, the tool calls, the background agent work — all of it, inaccessible.

## The Solution

```
npm install -g codeteleport
```

Teleport the session. Resume on the other machine. Full context intact.

---

## Quick Start

### 1. Install & Set up

```bash
npm install -g codeteleport
codeteleport setup
```

The setup wizard walks you through everything in 30 seconds — agent selection, login, device name, and MCP registration.

CodeTeleport supports three AI coding agents — Claude Code (id `claude-code`, the default), Codex (OpenAI, id `codex`), and Antigravity (Google, id `antigravity`). Choose interactively with `codeteleport setup` (which lists all supported agents from the registry) or directly with `codeteleport config set agent <claude-code|codex|antigravity>`. Setup also registers the MCP server using the chosen agent's command — `claude mcp add codeteleport -- codeteleport-mcp`, `codex mcp add codeteleport -- codeteleport-mcp`, or `agy mcp add codeteleport -- codeteleport-mcp`.

### 2. Teleport

Just talk to your AI coding agent (Claude Code, Codex, or Antigravity):

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

1. CodeTeleport detects the configured agent's coding session tied to your current directory
2. It bundles everything the agent stores for that session into a compressed `.tar.gz` — for Claude Code that's the conversation log (JSONL) plus sidecars (subagent logs, file history, paste cache, shell snapshots) and project memory; Codex and Antigravity bundle their own session artifacts (see [What Gets Teleported](#what-gets-teleported))
3. The bundle is uploaded to secure cloud storage, tagged with the original machine, directory path, and the agent that created it

### Pull

You sit down at Machine B, `cd` into your project directory, and pull:

1. CodeTeleport downloads the bundle
2. It sees the session was rooted at `/home/nawaaz/projects/my-app` on the original machine
3. It rewrites every path in the session to match your current directory — `/home/alice/work/my-app`. This is a two-pass rewrite (source home dir → target home dir, then source cwd → target cwd): a plain text replacement for Claude Code and Codex JSONL transcripts and memory/brain text files, and a binary, length-prefix-aware protobuf rewrite across the whole Antigravity SQLite conversation DB (field-length prefixes are recomputed so message framing stays valid)
4. The session is installed into the agent's local data directory — e.g. `~/.claude` for Claude Code, `~/.codex` for Codex, `~/.gemini/antigravity-cli` for Antigravity — linked to your current working directory

The agent sees it as a local session. Resume with the agent's resume command — `claude --resume <id>`, `codex resume <id>`, or `agy --conversation <id>`. The resume command and install destination are derived from the bundle's own recorded agent (the `agentId` in its `meta.json`), not from the puller's local config — legacy bundles default to `claude-code`.

**The key detail:** pull works from your current directory. Whatever directory you're in when you pull becomes the new root for the session. Paths are rewritten automatically — different username, different OS, different directory structure — it all just works. Bundles are self-describing — each records which agent created it, so it restores and resumes correctly even if the other machine is configured for a different agent.

**Codex first run on a new machine:** on pull, Codex writes the rollout transcript and upserts the thread-inventory row in `~/.codex/state_5.sqlite` so `codex resume <id>` finds the session. If `state_5.sqlite` does not exist yet on the target machine, the transcript is still restored but the thread row is not — run Codex once, then re-pull.

---

## Session Versioning

Every push saves a new version of the session. Go down the wrong path with your agent? Realize the approach from 50 messages ago was better? Pull an earlier version and pick up from there.

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

Seven tools available inside your AI coding agent (Claude Code, Codex, or Antigravity):

| Tool | Description |
| --- | --- |
| `teleport_push` | Push the current session to the cloud (creates a new version) |
| `teleport_pull` | Pull a session from the cloud (optionally a specific version) |
| `teleport_list` | List cloud sessions with metadata |
| `teleport_local_list` | List all local AI coding sessions on this machine |
| `teleport_versions` | Show version history for a session |
| `teleport_status` | Account info, plan, usage |
| `teleport_delete` | Delete a session and all its versions from the cloud |

`teleport_push` bundles the configured agent's current session and `teleport_local_list` scans that agent's local sessions, so both follow whatever you set with `codeteleport config set agent <id>`.

The MCP server is registered per agent — `codeteleport setup` runs the right command for the chosen agent automatically: `claude mcp add codeteleport -- codeteleport-mcp` (Claude Code), `codex mcp add codeteleport -- codeteleport-mcp` (Codex), or `agy mcp add codeteleport -- codeteleport-mcp` (Antigravity).

---

## CLI

The same operations are available from the terminal:

```bash
codeteleport setup             # First-time onboarding wizard
codeteleport push              # Interactive session picker → push to cloud
codeteleport pull              # Interactive session picker → pull from cloud
codeteleport pull --version N  # Pull a specific version
codeteleport list              # List local or cloud sessions
codeteleport versions <id>     # Show version history for a session
codeteleport status            # Account info, plan, usage
codeteleport config            # View current configuration
codeteleport config set agent <id>  # Switch agent: claude-code | codex | antigravity
codeteleport delete            # Delete a cloud session
codeteleport auth login        # Log in (GitHub OAuth or email)
```

`codeteleport setup` also offers agent selection interactively (it lists all supported agents from the registry). Setting an unrecognized id fails with `Unknown agent: <id>. Supported: claude-code, codex, antigravity`. The `agent` setting controls only what is bundled and scanned locally (push, local list) — it does not affect pull, which always uses the bundle's own recorded agent.

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

### Example: Pull (Claude Code)

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

The install destination (`to`) and `Resume with` line are derived from the bundle's own recorded agent, not your local config. A Codex bundle installs into `~/.codex` and prints `codex resume <id>`; an Antigravity bundle installs into `~/.gemini/antigravity-cli` and prints `agy --conversation <id>`.

---

## What Gets Teleported

What travels depends on the agent that created the bundle. Each agent stores its session differently, so CodeTeleport bundles each agent's own artifacts.

### Claude Code (default)

| Component | Description |
| --- | --- |
| Conversation log | Every message, tool call, and response (`~/.claude/projects/<encoded-cwd>/<id>.jsonl`) |
| Subagent conversations | Background agent logs |
| File history | Snapshots of files read or edited |
| Paste cache | Content pasted into the conversation |
| Project memory | The project's memory file(s) |
| Shell snapshots | Terminal state captured during the session |

Claude Code auto-includes files it edited via its Edit/Write tools.

### Codex

The rollout transcript JSONL (`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`) plus the thread-inventory row in `~/.codex/state_5.sqlite`. If `state_5.sqlite` doesn't exist yet on the target, the transcript still restores — run Codex once, then re-pull. Codex auto-detects only file edits made via `apply_patch`; shell/`exec_command` edits are opaque, so use `--include` for any temp or working files touched that way. Codex shell snapshots are excluded by default (may contain secrets).

### Antigravity

The conversation DB (`~/.gemini/antigravity-cli/conversations/<id>.db`) — a SQLite database whose payloads are protobuf, so the DB *is* the session — plus the `~/.gemini/antigravity-cli/brain/<id>/` folder (transcripts, artifacts, scratch). Antigravity has no edited-file auto-detection, so use `--include` for any working or temp files you want to travel.

### Explicit files

`--include` is the universal mechanism for adding working or temp files to any bundle regardless of agent. Per-file 25 MB / total 100 MB caps apply.

### Security

Bundles include only the agent's session state plus any files you explicitly `--include`. Credentials and secrets are never bundled — `auth.json`, `~/.ssh`, `~/.aws`, `*.pem`/`*.key`, `.env*`, `id_rsa`, `.npmrc`, `.netrc`, and Codex logs/memories DBs are all excluded. Restore is contained to the target project and temp roots.

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

## Requirements

Node.js >= 22.5.0 — the CLI uses the built-in `node:sqlite` module to read and write the Codex and Antigravity session databases. Runs on macOS, Linux, and Windows.

## Platform Support

| Platform | Status |
| --- | --- |
| macOS | Fully supported |
| Linux | Fully supported |
| Windows | Fully supported |

---

## Links

| | |
| --- | --- |
| **Documentation** | [docs.codeteleport.com](https://docs.codeteleport.com) |
| **Dashboard** | [app.codeteleport.com](https://app.codeteleport.com) |
| **Website** | [codeteleport.com](https://codeteleport.com) |
| **npm** | [codeteleport](https://www.npmjs.com/package/codeteleport) |
| **GitHub** | [korvol/codeteleport](https://github.com/korvol/codeteleport) |
| **Support** | [support.codeteleport.com](https://support.codeteleport.com) · [GitHub Issues](https://github.com/korvol/codeteleport/issues) |
| **Discord** | [discord.gg/c69JYPWS](https://discord.gg/c69JYPWS) |

---

## License

MIT
