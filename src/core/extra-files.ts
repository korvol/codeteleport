import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXTRA_FILE_MAX_BYTES, EXTRA_TOTAL_MAX_BYTES } from "../shared/constants";
import { isSensitivePath, isUnder, safeRealpath } from "./paths";

export interface CollectExtraFilesParams {
	/** Caller-supplied absolute paths (MCP mode). */
	includePaths: string[];
	/** Edit/Write file paths from the scanner. */
	filesModified: string[];
	/** Session cwd — allowlisted root. */
	cwd: string;
	/** Source user home dir — used to anchor the sensitive deny-list. */
	homeDir: string;
	/** Where to copy included files (a `extra-files/` subdir is created here). */
	stagingDir: string;
	/** Real paths already bundled (session subdir, file-history) — used for dedupe. */
	alreadyBundledRealRoots?: string[];
	/** Allowlisted root dirs. Defaults to [cwd, os.tmpdir(), "/tmp", "/private/tmp"]. */
	allowedRoots?: string[];
	perFileMax?: number;
	totalMax?: number;
}

export interface CollectExtraFilesResult {
	included: Array<{ path: string; sizeBytes: number; stored: string }>;
	skipped: Array<{ path: string; reason: string }>;
}

/**
 * Collect working/temp files to bundle (Part B). Filters the union of caller-supplied
 * includePaths and scanner-detected filesModified through an allowlist + sensitive
 * deny-list + size caps + dedupe, copying survivors into `<stagingDir>/extra-files/`.
 *
 * Agent-agnostic: shared by every adapter's bundle step.
 */
export function collectExtraFiles(params: CollectExtraFilesParams): CollectExtraFilesResult {
	const {
		includePaths,
		filesModified,
		cwd,
		homeDir,
		stagingDir,
		alreadyBundledRealRoots = [],
		perFileMax = EXTRA_FILE_MAX_BYTES,
		totalMax = EXTRA_TOTAL_MAX_BYTES,
	} = params;

	const allowedRoots = (params.allowedRoots ?? [cwd, os.tmpdir(), "/tmp", "/private/tmp"]).map(safeRealpath);
	const bundledRoots = alreadyBundledRealRoots.map(safeRealpath);

	const included: CollectExtraFilesResult["included"] = [];
	const skipped: CollectExtraFilesResult["skipped"] = [];

	// Union, includePaths first, deduped by resolved original path.
	// Relative paths anchor to the session cwd (not the bundler's process.cwd()).
	const seenOriginal = new Set<string>();
	const candidates: string[] = [];
	for (const p of [...includePaths, ...filesModified]) {
		const resolved = path.resolve(cwd, p);
		if (seenOriginal.has(resolved)) continue;
		seenOriginal.add(resolved);
		candidates.push(resolved);
	}

	const seenReal = new Set<string>();
	const extraDir = path.join(stagingDir, "extra-files");
	let runningTotal = 0;

	for (const original of candidates) {
		let stat: fs.Stats;
		try {
			stat = fs.statSync(original); // follows symlinks; throws on missing / broken link
		} catch {
			skipped.push({ path: original, reason: "not found" });
			continue;
		}
		if (!stat.isFile()) {
			skipped.push({ path: original, reason: "not a regular file" });
			continue;
		}

		const realPath = safeRealpath(original);

		if (isSensitivePath(original, realPath, homeDir)) {
			skipped.push({ path: original, reason: "sensitive path" });
			continue;
		}
		if (!allowedRoots.some((root) => isUnder(realPath, root))) {
			skipped.push({ path: original, reason: "outside allowed roots" });
			continue;
		}
		if (bundledRoots.some((root) => isUnder(realPath, root))) {
			skipped.push({ path: original, reason: "already in bundle" });
			continue;
		}
		if (seenReal.has(realPath)) continue; // duplicate of an already-included file
		if (stat.size > perFileMax) {
			skipped.push({ path: original, reason: "exceeds per-file size cap" });
			continue;
		}
		if (runningTotal + stat.size > totalMax) {
			skipped.push({ path: original, reason: "exceeds total size cap" });
			continue;
		}

		seenReal.add(realPath);
		fs.mkdirSync(extraDir, { recursive: true });
		const stored = crypto.createHash("sha1").update(original).digest("hex");
		fs.copyFileSync(realPath, path.join(extraDir, stored));
		runningTotal += stat.size;
		included.push({ path: original, sizeBytes: stat.size, stored });
	}

	return { included, skipped };
}
