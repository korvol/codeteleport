import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { BUNDLE_FORMAT_VERSION } from "../../../shared/constants";
import type { BundleOptions, BundleResult } from "../../../shared/types";
import { collectExtraFiles } from "../../extra-files";
import { sha256File } from "../../fsutil";
import { openDb } from "../../sqlite";
import { antigravityDirDefault, findAntigravityDbPath, scanAntigravityLocalSessions } from "./local";

/** Bundle an Antigravity conversation: its SQLite DB + the brain/<id> folder. */
export async function bundleAntigravitySession(options: BundleOptions): Promise<BundleResult> {
	const { sessionId, cwd } = options;
	const gemDir = options.geminiDir ?? antigravityDirDefault();
	const sourceUserDir = options.sourceUserDir ?? os.homedir();
	const outputDir = options.outputDir ?? os.tmpdir();

	const dbPath = findAntigravityDbPath(sessionId, gemDir);
	if (!dbPath) {
		throw new Error(`Antigravity conversation not found for ${sessionId} under ${path.join(gemDir, "conversations")}`);
	}
	const resolvedId = path.basename(dbPath, ".db");

	// Fold the WAL into the main DB so the copied file is complete.
	try {
		const db = openDb(dbPath);
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		db.close();
	} catch {}

	const summary = scanAntigravityLocalSessions(gemDir).find((s) => s.sessionId === resolvedId);
	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeteleport-agy-"));

	try {
		const meta = {
			sessionId: resolvedId,
			sourceCwd: cwd,
			sourceUserDir,
			agentId: "antigravity",
			formatVersion: BUNDLE_FORMAT_VERSION,
			sourceGeminiHome: gemDir,
		};
		fs.writeFileSync(path.join(stagingDir, "meta.json"), JSON.stringify(meta, null, 2));

		fs.copyFileSync(dbPath, path.join(stagingDir, "session.db"));

		const brainSrc = path.join(gemDir, "brain", resolvedId);
		if (fs.existsSync(brainSrc)) {
			fs.cpSync(brainSrc, path.join(stagingDir, "brain"), { recursive: true });
		}

		// Part B: caller-supplied extra working/temp files (no auto-detection for Antigravity).
		const extra = collectExtraFiles({
			includePaths: options.includePaths ?? [],
			filesModified: [],
			cwd,
			homeDir: sourceUserDir,
			stagingDir,
		});
		if (extra.included.length > 0) {
			const manifest = extra.included.map((e) => ({
				stored: e.stored,
				originalPath: e.path,
				sizeBytes: e.sizeBytes,
				rewriteContent: false,
			}));
			fs.writeFileSync(path.join(stagingDir, "extra-files-manifest.json"), JSON.stringify(manifest, null, 2));
		}

		const bundlePath = path.join(outputDir, `antigravity-session-${resolvedId}.tar.gz`);
		await tar.create({ gzip: true, file: bundlePath, cwd: stagingDir }, fs.readdirSync(stagingDir));

		const checksum = await sha256File(bundlePath);
		const sizeBytes = fs.statSync(bundlePath).size;

		return {
			bundlePath,
			sessionId: resolvedId,
			sourceCwd: cwd,
			sourceUserDir,
			sizeBytes,
			checksum: `sha256:${checksum}`,
			metadata: {
				agentId: "antigravity",
				projectName: path.basename(cwd),
				messageCount: summary?.messageCount,
				extraFileCount: extra.included.length,
				extraFilesIncluded: extra.included.length > 0 ? extra.included.map((e) => e.path) : undefined,
			},
			extraFiles: {
				included: extra.included.map((e) => ({ path: e.path, sizeBytes: e.sizeBytes })),
				skipped: extra.skipped,
			},
		};
	} finally {
		fs.rmSync(stagingDir, { recursive: true, force: true });
	}
}
