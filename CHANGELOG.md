# Changelog

## 0.5.0 (2026-06-18)

- **Cross-agent conversion** — `codeteleport pull <id> --as <claude-code|codex>` converts a pulled session into another agent's format on install (the `teleport_pull` MCP tool gains the same `as` option). Supported directions: Claude Code ↔ Codex, and Antigravity → Claude Code / Codex. Pulling without `--as` restores natively as before. Conversion is transcript-level: the conversation history carries over, but file history, exact tool-call fidelity, and agent-specific sidecars do not. Antigravity cannot be a conversion *target* (its session format can't be synthesized), only a source.

## 0.4.0 (2026-06-18)

- **Multi-agent support** — CodeTeleport now teleports sessions for three AI coding agents: **Claude Code** (default), **Codex** (OpenAI), and **Antigravity** (Google). Choose your agent with `codeteleport config set agent <claude-code|codex|antigravity>` or interactively via `codeteleport setup`.
- **Self-describing bundles** — every bundle records the agent that created it (`agentId` in `meta.json`), so `pull` restores into the correct agent's native location and prints the right resume command regardless of the target machine's configured agent. Legacy bundles with no `agentId` are treated as Claude Code.
- **Codex** — bundles the rollout transcript plus the thread-inventory row from `~/.codex/state_5.sqlite`; on `pull` the transcript is written and the thread row is upserted so `codex resume <id>` finds the session (if `state_5.sqlite` doesn't exist yet, run Codex once and re-pull). Modified-file auto-detection covers `apply_patch` edits; use `--include` for shell-created files. Shell snapshots are excluded by default.
- **Antigravity** — bundles the SQLite conversation DB (`~/.gemini/antigravity-cli/conversations/<id>.db`) and the `brain/<id>/` folder; on `pull`, absolute paths embedded in the protobuf BLOBs are rewritten (length-prefix-aware, across every blob column) alongside the brain text files. Resume with `agy --conversation <id>`.
- **Cloud sessions are scoped by agent** — `list` and `pull` default to your configured agent and label each cloud session with its agent; use `--agent <id>` to view another or `--all` to see every agent. The `teleport_list`/`teleport_pull` MCP tools accept the same `agent` filter. Pulling a specific session by ID still works across agents.
- **Requires Node.js >= 22.5.0** — the CLI uses the built-in `node:sqlite` module to read and write Codex/Antigravity session state.

## 0.3.0 (2026-06-17)

- **Project memory bundling** — `push` now bundles project memory (`~/.claude/projects/<cwd>/memory/`) and `pull` restores it under the target project. The default `merge` policy unions `MEMORY.md` by line and never clobbers other hand-edited memory files (`overwrite` / `skip` also available).
- **Working/temp file bundling** — `codeteleport push --include <paths>` (comma-separated, repeatable) and the `includePaths` field on the `teleport_push` MCP tool bundle extra files a session created or depends on (e.g. `/tmp/*.json`); they are restored to their path-rewritten locations on `pull`. Files edited via Edit/Write during the session are included automatically. An allowlist (cwd / temp roots), a sensitive deny-list (`~/.ssh`, `~/.aws`, `*.pem`, `*.key`, `.env*`, `id_*`, `.netrc`, `.npmrc`, `credentials`, …), and 25 MB/file · 100 MB total caps guard what leaves the machine, and `push` prints a manifest of what was included and skipped. Restore is contained to the target project/temp roots so a bundle can't write outside them.

## 0.2.3 (2026-04-02)

- **README updated** — improved documentation with clearer examples and links

## 0.2.2 (2026-04-02)

- **Setup wizard** — `codeteleport setup` walks through agent, auth, device, and MCP in one command
- **Config command** — `codeteleport config` to view, `codeteleport config set` to update settings
- **Agent registry** — extensible agent config system (claude-code default)
- **Generic descriptions** — MCP tools and CLI messages no longer hardcode agent names

## 0.2.0 (2026-04-01)

- **Package renamed** — `@codeteleport/mcp` is now `codeteleport`. Install with `npm install -g codeteleport`
- **Documentation site** — full docs at [docs.codeteleport.com](https://docs.codeteleport.com)

## 0.1.7 (2026-03-31)

- **Plans config** — centralized plan limits and features in single source of truth

## 0.1.6 (2026-03-27)

- **Graceful error handling** — MCP tools return `isError: true` instead of crashing, CLI shows clean messages
- **User info in status** — `codeteleport status` and `teleport_status` show email, plan, sessions/devices usage
- **GET /v1/auth/me** — new API endpoint returns current user info
- **teleport_local_list** — new MCP tool scans local sessions from `~/.claude/`
- **list --local/--cloud** — `codeteleport list` prompts for local vs cloud, `--push` for batch upload
- **Corrupt config handling** — helpful message instead of JSON parse crash

## 0.1.5 (2026-03-27)

- **Interactive push** — `codeteleport push` scans current directory for sessions, shows picker if multiple found
- **Interactive pull** — `codeteleport pull` lists cloud sessions, always prompts before downloading
- **GitHub OAuth login** — `codeteleport auth login --github` opens browser for GitHub OAuth flow
- **Login method prompt** — `codeteleport auth login` asks: (1) GitHub (2) Email & Password
- **`--api-url` flag** — `codeteleport auth login --api-url http://localhost:8787` for local dev
- **Local session scanner** — reads `cwd` from JSONL data (not ambiguous directory name decoding)
- **Unconfirmed upload retry** — stale uploads no longer block re-push with 409

## 0.1.3 (2026-03-26)

- **MCP tool input schemas** — all 5 tools now expose typed parameters to Claude Code (sessionId, targetDir, machine, tag, limit, label, tags)
- **Push auto-overwrite** — pushing an existing session deletes the old version first instead of returning 409
- **Zod v4** — upgraded from zod@3.25.76 (v4 bridge) to native zod@4, fixes TS2589 infinite type recursion with MCP SDK
- **Custom domain** — API URL updated to `api.codeteleport.com`

## 0.1.2 (2026-03-25)

- **MCP server ESM fix** — dynamic `import()` for ESM MCP SDK modules, fixes CJS compatibility
- **Custom domain route** — added `api.codeteleport.com` Worker route in wrangler.toml
- **Hardcoded API URL** — no environment variable needed for users
- **Two-pass unbundle** — matches `scripts/unpack.sh` behavior: user dir swap + project path anchoring
- **`--target-dir` flag** — on CLI pull and MCP teleport_pull tool
- **`detectHomeDir`** — auto-detects /Users/x, /home/x, /root from full path
- **Detailed MCP tool descriptions** — multi-line with natural language examples

## 0.1.1 (2026-03-25)

- **npm publish prep** — README, license, keywords, repository, files field
- **Platform support** — macOS and Linux (Windows not yet)

## 0.1.0 (2026-03-25)

- **Initial release**
- CLI: `codeteleport auth login`, `push`, `pull`, `list`, `status`, `delete`
- MCP server: `teleport_push`, `teleport_pull`, `teleport_list`, `teleport_status`, `teleport_delete`
- Core engine: bundle/unbundle with path rewriting, JSONL scanning, metadata extraction
- API client for CodeTeleport backend
- Config management (`~/.codeteleport/config.json`)
