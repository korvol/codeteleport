import type { BundleResult } from "../shared/types";

function kb(bytes: number): string {
	return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Human-readable summary of what extra files + memory left the machine on a push.
 * This is the user's safety review. Returns "" when there is nothing to report.
 */
export function formatBundleManifest(bundle: BundleResult): string {
	const lines: string[] = [];
	const included = bundle.extraFiles?.included ?? [];
	const skipped = bundle.extraFiles?.skipped ?? [];

	if (included.length > 0) {
		lines.push(`Included extra files (${included.length}):`);
		for (const f of included) lines.push(`  ${f.path}  ${kb(f.sizeBytes)}`);
	}
	if (skipped.length > 0) {
		lines.push(`Skipped (${skipped.length}):`);
		for (const f of skipped) lines.push(`  ${f.path}  ${f.reason}`);
	}
	const memCount = bundle.metadata.memoryFileCount;
	if (memCount) {
		lines.push(`Memory: ${memCount} file${memCount === 1 ? "" : "s"} bundled`);
	}

	return lines.join("\n");
}

/** Flatten repeated/comma-separated --include values into a clean path list. */
export function parseIncludePaths(raw: string[]): string[] {
	return raw.flatMap((v) => v.split(",").map((s) => s.trim())).filter(Boolean);
}

export const EXTRA_FILES_CLI_HINT =
	"⚠️  Temp/Bash-created files can't be auto-detected from the CLI. Re-run the sync from inside the chat to include them, or pass --include <path>. (Edit/Write files and memory were still bundled.)";
