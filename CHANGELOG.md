# Changelog

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
