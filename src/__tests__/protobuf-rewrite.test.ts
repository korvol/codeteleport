import { describe, expect, it } from "vitest";
import { rewriteProtobuf } from "../core/agents/antigravity/protobuf";

// ── minimal protobuf encode/decode helpers for the tests ──
function vEnc(n: number): Buffer {
	const b: number[] = [];
	let t = n;
	while (t >= 0x80) {
		b.push((t & 0x7f) | 0x80);
		t >>>= 7;
	}
	b.push(t);
	return Buffer.from(b);
}
function vDec(buf: Buffer, off: number): [number, number] {
	let val = 0;
	let shift = 0;
	let bytes = 0;
	for (;;) {
		const byte = buf[off + bytes];
		val |= (byte & 0x7f) << shift;
		bytes++;
		if ((byte & 0x80) === 0) break;
		shift += 7;
	}
	return [val, bytes];
}
/** Encode a length-delimited field (wire type 2). */
function ld(fieldNum: number, payload: Buffer): Buffer {
	return Buffer.concat([vEnc((fieldNum << 3) | 2), vEnc(payload.length), payload]);
}
function strField(fieldNum: number, s: string): Buffer {
	return ld(fieldNum, Buffer.from(s, "utf8"));
}
/** Read the first length-delimited field `wantField` (assumes all fields are LD). */
function readLD(buf: Buffer, wantField: number): Buffer | null {
	let o = 0;
	while (o < buf.length) {
		const [key, kb] = vDec(buf, o);
		o += kb;
		const fn = key >> 3;
		const [len, lb] = vDec(buf, o);
		o += lb;
		const val = buf.subarray(o, o + len);
		o += len;
		if (fn === wantField) return val;
	}
	return null;
}

describe("rewriteProtobuf", () => {
	it("rewrites a length-delimited string field and fixes the length prefix (different lengths)", () => {
		const buf = strField(1, "/Users/alice/app/x.ts");
		const out = rewriteProtobuf(buf, "/Users/alice", "/home/bob");
		const got = readLD(out, 1)?.toString("utf8");
		expect(got).toBe("/home/bob/app/x.ts");
		// length prefix must equal the new byte length (not the old one)
		const [len] = vDec(out, 1);
		expect(len).toBe(Buffer.byteLength("/home/bob/app/x.ts"));
	});

	it("recurses into nested sub-messages and fixes every length prefix", () => {
		const inner = strField(1, "/Users/alice/proj/main.rs");
		const buf = ld(1, inner); // field 1 = sub-message
		const out = rewriteProtobuf(buf, "/Users/alice", "/home/bob");
		const innerOut = readLD(out, 1);
		expect(innerOut).not.toBeNull();
		const got = readLD(innerOut as Buffer, 1)?.toString("utf8");
		expect(got).toBe("/home/bob/proj/main.rs");
		// outer length prefix updated to match the (shorter) rewritten inner message
		const [outerLen] = vDec(out, 1);
		expect(outerLen).toBe((innerOut as Buffer).length);
	});

	it("rewrites multiple occurrences and leaves non-matching fields intact", () => {
		const buf = Buffer.concat([
			strField(1, "/Users/alice/a"),
			strField(2, "no-paths-here"),
			strField(3, "/Users/alice/b"),
		]);
		const out = rewriteProtobuf(buf, "/Users/alice", "/home/bob");
		expect(readLD(out, 1)?.toString()).toBe("/home/bob/a");
		expect(readLD(out, 2)?.toString()).toBe("no-paths-here");
		expect(readLD(out, 3)?.toString()).toBe("/home/bob/b");
	});

	it("returns the buffer unchanged when from === to or from is empty", () => {
		const buf = strField(1, "/Users/alice/x");
		expect(rewriteProtobuf(buf, "/Users/alice", "/Users/alice").equals(buf)).toBe(true);
		expect(rewriteProtobuf(buf, "", "/home/bob").equals(buf)).toBe(true);
	});

	it("preserves equal-length replacements byte-for-byte in structure", () => {
		const buf = strField(1, "/Users/alice/x");
		const out = rewriteProtobuf(buf, "/Users/alice", "/Users/bobby"); // same length (12)
		expect(readLD(out, 1)?.toString()).toBe("/Users/bobby/x");
		expect(out.length).toBe(buf.length);
	});
});
