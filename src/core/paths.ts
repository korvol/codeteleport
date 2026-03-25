/**
 * Encode a filesystem path the way Claude Code does for project directories.
 * e.g. "/Users/alice/myproject" → "-Users-alice-myproject"
 */
export function encodePath(fsPath: string): string {
	return fsPath.replace(/\//g, "-");
}

/**
 * Rewrite all occurrences of sourceUserDir to targetUserDir in a string.
 * This is the core path-rewriting logic that makes sessions portable.
 */
export function rewritePaths(content: string, sourceUserDir: string, targetUserDir: string): string {
	return content.split(sourceUserDir).join(targetUserDir);
}

/**
 * Auto-detect the user home directory from a full path.
 * /Users/alice/foo/bar → /Users/alice
 * /home/alice/foo/bar  → /home/alice
 * /root/foo/bar        → /root
 */
export function detectHomeDir(fullPath: string): string {
	const macosMatch = fullPath.match(/^(\/Users\/[^/]+)/);
	if (macosMatch) return macosMatch[1];

	const linuxMatch = fullPath.match(/^(\/home\/[^/]+)/);
	if (linuxMatch) return linuxMatch[1];

	const rootMatch = fullPath.match(/^(\/root)/);
	if (rootMatch) return rootMatch[1];

	throw new Error(`could not auto-detect home dir from: ${fullPath}`);
}
