# @codeteleport/mcp

Teleport your Claude Code sessions across devices. Pick up any conversation, on any machine, instantly.

## What it does

CodeTeleport syncs Claude Code sessions between machines. It bundles your conversation history, subagents, file history, paste cache, and shell snapshots into a portable archive, uploads it to the cloud, and restores it on another machine — with automatic path rewriting so everything works regardless of username or directory structure.

## Install

```bash
npm install -g @codeteleport/mcp
```

## Quick start

### 1. Login

```bash
codeteleport auth login
```

### 2. Push a session (from inside Claude Code)

```bash
codeteleport push
```

Or say "teleport this session" if using the MCP integration.

### 3. Pull on another machine

```bash
codeteleport pull
claude --resume <session-id>
```

### Pull to a specific directory (recommended)

Use `--target-dir` to tell CodeTeleport exactly where the project lives on this machine. This is the recommended approach because it handles everything automatically — it detects your home directory from the path, locates your `~/.claude` directory, and rewrites all internal paths correctly.

```bash
codeteleport pull --session-id <id> --target-dir /Users/bob/work/my-project
```

This does a two-pass path rewrite:
1. Swaps the source username for the target (e.g., `/Users/alice` → `/Users/bob`)
2. Remaps the project path to the target directory (e.g., `/Users/bob/projects/code-teleport` → `/Users/bob/work/my-project`)

Without `--target-dir`, CodeTeleport defaults to your home directory and assumes the same project path structure as the source machine. This works when both machines have the same directory layout but will break if the project lives at a different path.

## Claude Code MCP integration

Add CodeTeleport as an MCP server so you can push/pull sessions directly from Claude Code:

```bash
npm install -g @codeteleport/mcp
claude mcp add codeteleport -- codeteleport-mcp
```

Or add to your Claude Code `settings.json`:

```json
{
  "mcpServers": {
    "codeteleport": {
      "command": "codeteleport-mcp"
    }
  }
}
```

Then inside Claude Code, you can say:
- "Push this session to CodeTeleport"
- "Pull my session from my MacBook"
- "List my teleported sessions"

## CLI commands

| Command | Description |
|---|---|
| `codeteleport auth login` | Log in (or `--register` to create account) |
| `codeteleport auth logout` | Remove local credentials |
| `codeteleport push` | Push current session to the cloud |
| `codeteleport pull` | Pull a session from the cloud |
| `codeteleport list` | List all stored sessions |
| `codeteleport status` | Show account and sync status |
| `codeteleport delete <id>` | Delete a session from the cloud |

## MCP tools

When used as an MCP server, CodeTeleport exposes these tools:

| Tool | Description |
|---|---|
| `teleport_push` | Push the current session |
| `teleport_pull` | Pull a session (by ID or pick from list) |
| `teleport_list` | List all stored sessions |
| `teleport_status` | Show account status |
| `teleport_delete` | Delete a session |

## How it works

1. **Bundle** — packages the Claude Code session (JSONL conversation, subagents, file history, paste cache, shell snapshots) into a `.tar.gz`
2. **Upload** — pushes the bundle to CodeTeleport's cloud storage via presigned URLs
3. **Download** — pulls the bundle onto the target machine
4. **Unbundle** — extracts and rewrites all internal paths (e.g., `/Users/alice` → `/Users/bob`) so the session works on the new machine
5. **Resume** — `claude --resume <session-id>` picks up exactly where you left off

## Platform support

- macOS — fully supported
- Linux — fully supported
- Windows — not yet supported (path detection assumes Unix-style paths)

## Documentation

Full docs at **[docs.codeteleport.com](https://docs.codeteleport.com)** — installation, CLI reference, MCP integration, concepts, troubleshooting, and more.

## License

MIT
