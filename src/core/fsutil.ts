import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Stream a file through SHA-256 and return the hex digest. */
export function sha256File(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256");
		const stream = fs.createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
		stream.on("error", reject);
	});
}

/** Recursively count files under `dir` whose name ends with `ext` ("" counts all). */
export function countFiles(dir: string, ext: string): number {
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
