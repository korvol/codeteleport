import { describe, expect, it } from "vitest";
import { EXTRA_FILES_CLI_HINT, formatBundleManifest, parseIncludePaths } from "../core/manifest";
import type { BundleResult } from "../shared/types";

function makeBundle(partial: Partial<BundleResult>): BundleResult {
	return {
		bundlePath: "/tmp/b.tar.gz",
		sessionId: "s",
		sourceCwd: "/c",
		sourceUserDir: "/h",
		sizeBytes: 1,
		checksum: "sha256:x",
		metadata: {},
		...partial,
	};
}

describe("formatBundleManifest", () => {
	it("lists included files with sizes", () => {
		const out = formatBundleManifest(
			makeBundle({ extraFiles: { included: [{ path: "/tmp/a.json", sizeBytes: 2048 }], skipped: [] } }),
		);
		expect(out).toContain("Included extra files (1):");
		expect(out).toContain("/tmp/a.json");
		expect(out).toContain("2 KB");
	});

	it("lists skipped files with reasons", () => {
		const out = formatBundleManifest(
			makeBundle({
				extraFiles: { included: [], skipped: [{ path: "/tmp/huge.bin", reason: "exceeds per-file size cap" }] },
			}),
		);
		expect(out).toContain("Skipped (1):");
		expect(out).toContain("/tmp/huge.bin");
		expect(out).toContain("per-file");
	});

	it("reports the memory file count", () => {
		const out = formatBundleManifest(
			makeBundle({ extraFiles: { included: [], skipped: [] }, metadata: { hasMemory: true, memoryFileCount: 2 } }),
		);
		expect(out).toContain("Memory: 2 files bundled");
	});

	it("returns an empty string when there is nothing to report", () => {
		const out = formatBundleManifest(makeBundle({ extraFiles: { included: [], skipped: [] } }));
		expect(out).toBe("");
	});
});

describe("parseIncludePaths", () => {
	it("flattens comma-separated and repeated values, trimming and dropping blanks", () => {
		expect(parseIncludePaths(["/a, /b", "/c", "  "])).toEqual(["/a", "/b", "/c"]);
	});

	it("returns an empty array for no input", () => {
		expect(parseIncludePaths([])).toEqual([]);
	});
});

describe("EXTRA_FILES_CLI_HINT", () => {
	it("mentions --include and that memory/edited files were still bundled", () => {
		expect(EXTRA_FILES_CLI_HINT).toContain("--include");
		expect(EXTRA_FILES_CLI_HINT.toLowerCase()).toContain("memory");
	});
});
