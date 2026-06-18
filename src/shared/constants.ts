import os from "node:os";
import path from "node:path";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");

/**
 * Config directory. Defaults to ~/.codeteleport, but can be redirected with the
 * CODETELEPORT_CONFIG_DIR env var so a session (e.g. the e2e harness, or a second
 * account) runs against an isolated config without touching the real one.
 */
export const CONFIG_DIR = process.env.CODETELEPORT_CONFIG_DIR || path.join(os.homedir(), ".codeteleport");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export const API_URL = "https://api.codeteleport.com/v1";

// ── Multi-agent bundling ──

/** Agent a bundle is assumed to come from when meta.json predates the agentId field. */
export const DEFAULT_AGENT_ID = "claude-code";

/** Bundle envelope version. Bumped to 2 when meta.json gained agentId. */
export const BUNDLE_FORMAT_VERSION = 2;

/**
 * Agent ids the bundler/unbundler can currently handle. Grows as adapters land
 * (claude-code today; codex next). Kept separate from the agent *registry*
 * (shared/agents.ts) so a registry entry can exist before its adapter does.
 */
export const SUPPORTED_AGENT_IDS = ["claude-code", "codex", "antigravity"] as const;

/** Codex home directory (~/.codex), overridable for tests. */
export const CODEX_DIR = path.join(os.homedir(), ".codex");

/** Antigravity home directory (~/.gemini/antigravity-cli), overridable for tests. */
export const ANTIGRAVITY_DIR = path.join(os.homedir(), ".gemini", "antigravity-cli");

/** Throw a consistent error for an agent id without a bundle/unbundle adapter. */
export function assertSupportedAgent(agentId: string): void {
	if (!(SUPPORTED_AGENT_IDS as readonly string[]).includes(agentId)) {
		throw new Error(`Unknown agent: ${agentId}. Supported: ${SUPPORTED_AGENT_IDS.join(", ")}`);
	}
}

// ── Extra working/temp file bundling (see spec: bundle memory + extra files) ──

/** Per-file size cap for bundled extra files. Files larger than this are skipped. */
export const EXTRA_FILE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
/** Total size cap across all bundled extra files. Once hit, no more are added. */
export const EXTRA_TOTAL_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Sensitive directory names, anchored under the user's home dir, whose contents
 * are NEVER bundled as extra files — even if they sit under an allowed parent.
 * e.g. ~/.ssh, ~/.aws, ~/.config, ~/.gnupg
 */
export const SENSITIVE_HOME_DIRS = [".ssh", ".aws", ".config", ".gnupg"];

/**
 * Sensitive filename patterns (matched against the basename). Any extra-file
 * candidate whose name matches is hard-rejected regardless of location.
 * Covers private keys (*.pem/*.key/*.p12/*.pfx/*.pkcs8/*.p8/*.jks/*.keystore,
 * id_rsa/dsa/ecdsa/ed25519), env files, and common credential files
 * (.netrc, .npmrc, AWS-style `credentials`).
 */
export const SENSITIVE_FILE_PATTERNS: RegExp[] = [
	/\.pem$/i,
	/\.key$/i,
	/\.(p12|pfx|pkcs8|p8|jks|keystore)$/i,
	/^\.env/i,
	/^id_(rsa|dsa|ecdsa|ed25519)/i,
	/^\.netrc$/i,
	/^\.npmrc$/i,
	/^credentials$/i,
];
