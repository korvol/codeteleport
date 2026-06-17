import os from "node:os";
import path from "node:path";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");
export const CONFIG_DIR = path.join(os.homedir(), ".codeteleport");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export const API_URL = "https://api.codeteleport.com/v1";

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
