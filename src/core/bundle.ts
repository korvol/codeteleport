import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { CLAUDE_DIR } from "../shared/constants";
import type { BundleOptions, BundleResult } from "../shared/types";
import { encodePath } from "./paths";
import { scanSession } from "./scanner";

export async function bundleSession(options: BundleOptions): Promise<BundleResult> {
	const { sessionId, cwd } = options;
	const outputDir = options.outputDir ?? os.tmpdir();
	const claudeDir = options.claudeDir ?? CLAUDE_DIR;
	const sourceUserDir = options.sourceUserDir ?? os.homedir();
	const encodedCwd = encodePath(cwd);

	const projDir = path.join(claudeDir, "projects", encodedCwd);
	const jsonlPath = path.join(projDir, `${sessionId}.jsonl`);

	if (!fs.existsSync(jsonlPath)) {
		throw new Error(`Session JSONL not found at ${jsonlPath}`);
	}

	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeteleport-"));

	try {
		// 1. Scan JSONL for assets + metadata
		const { assets, metadata } = await scanSession(jsonlPath);

		// 2. Write meta.json
		const meta = { sessionId, sourceCwd: cwd, sourceUserDir };
		fs.writeFileSync(path.join(stagingDir, "meta.json"), JSON.stringify(meta, null, 2));

		// 3. Copy session JSONL
		fs.copyFileSync(jsonlPath, path.join(stagingDir, "session.jsonl"));

		// 4. Copy session subdirectory (subagents etc.)
		const sessionSubdir = path.join(projDir, sessionId);
		let subagentCount = 0;
		if (fs.existsSync(sessionSubdir) && fs.statSync(sessionSubdir).isDirectory()) {
			fs.cpSync(sessionSubdir, path.join(stagingDir, "session-subdir"), { recursive: true });
			// Count subagent JSONL files
			subagentCount = countFiles(path.join(stagingDir, "session-subdir"), ".jsonl");
		}

		// 5. Copy file-history
		const fileHistoryDir = path.join(claudeDir, "file-history", sessionId);
		const hasFileHistory = fs.existsSync(fileHistoryDir);
		if (hasFileHistory) {
			fs.cpSync(fileHistoryDir, path.join(stagingDir, "file-history"), { recursive: true });
		}

		// 6. Copy session-env
		const sessionEnvDir = path.join(claudeDir, "session-env", sessionId);
		if (fs.existsSync(sessionEnvDir)) {
			fs.cpSync(sessionEnvDir, path.join(stagingDir, "session-env"), { recursive: true });
		}

		// 7. Copy paste-cache files
		const hasPasteCache = assets.pasteFiles.length > 0;
		if (hasPasteCache) {
			const pasteCacheDir = path.join(stagingDir, "paste-cache");
			fs.mkdirSync(pasteCacheDir, { recursive: true });
			for (const fname of assets.pasteFiles) {
				const src = path.join(claudeDir, "paste-cache", fname);
				if (fs.existsSync(src)) {
					fs.copyFileSync(src, path.join(pasteCacheDir, fname));
				}
			}
		}

		// 8. Copy shell-snapshot files
		const hasShellSnapshots = assets.shellSnapshots.length > 0;
		if (hasShellSnapshots) {
			const shellDir = path.join(stagingDir, "shell-snapshots");
			fs.mkdirSync(shellDir, { recursive: true });
			for (const fname of assets.shellSnapshots) {
				const src = path.join(claudeDir, "shell-snapshots", fname);
				if (fs.existsSync(src)) {
					fs.copyFileSync(src, path.join(shellDir, fname));
				}
			}
		}

		// 9. Create tar.gz
		const bundleFilename = `claude-session-${sessionId}.tar.gz`;
		const bundlePath = path.join(outputDir, bundleFilename);

		await tar.create({ gzip: true, file: bundlePath, cwd: stagingDir }, fs.readdirSync(stagingDir));

		// 10. Calculate checksum
		const checksum = await sha256File(bundlePath);
		const sizeBytes = fs.statSync(bundlePath).size;
		const jsonlSizeBytes = fs.statSync(jsonlPath).size;

		// 11. Build project name from cwd
		const projectName = path.basename(cwd);

		return {
			bundlePath,
			sessionId,
			sourceCwd: cwd,
			sourceUserDir,
			sizeBytes,
			checksum: `sha256:${checksum}`,
			metadata: {
				...metadata,
				projectName,
				jsonlSizeBytes,
				subagentCount,
				hasFileHistory,
				hasPasteCache,
				hasShellSnapshots,
			},
		};
	} finally {
		fs.rmSync(stagingDir, { recursive: true, force: true });
	}
}

function sha256File(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256");
		const stream = fs.createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
		stream.on("error", reject);
	});
}

function countFiles(dir: string, ext: string): number {
	let count = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			count += countFiles(path.join(dir, entry.name), ext);
		} else if (entry.name.endsWith(ext)) {
			count++;
		}
	}
	return count;
}
