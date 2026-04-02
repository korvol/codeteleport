import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeTeleportClient } from "../client/api";

describe("CodeTeleportClient", () => {
	const mockFetch = vi.fn();
	const apiUrl = "https://api.test.com/v1";
	const token = "ctk_live_testtoken";

	beforeEach(() => {
		vi.stubGlobal("fetch", mockFetch);
		mockFetch.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function mockResponse(status: number, body: unknown) {
		return {
			ok: status >= 200 && status < 300,
			status,
			statusText: status === 200 ? "OK" : "Error",
			json: async () => body,
			arrayBuffer: async () => new ArrayBuffer(0),
		};
	}

	describe("constructor", () => {
		it("creates a client instance", () => {
			const client = new CodeTeleportClient({ apiUrl, token });
			expect(client).toBeDefined();
		});
	});

	describe("X-Client-Version header", () => {
		it("sends version header on authenticated requests", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(200, { sessions: [], total: 0 }));

			const client = new CodeTeleportClient({ apiUrl, token });
			await client.listSessions();

			const calledHeaders = mockFetch.mock.calls[0][1].headers;
			expect(calledHeaders["X-Client-Version"]).toBeDefined();
			expect(calledHeaders["X-Client-Version"]).toMatch(/^\d+\.\d+\.\d+$/);
		});
	});

	describe("401 handling", () => {
		it("throws helpful re-auth message on 401", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(401, { message: "Authentication required" }));

			const client = new CodeTeleportClient({ apiUrl, token });
			await expect(client.listSessions()).rejects.toThrow("codeteleport setup");
		});

		it("throws helpful message on 403 unauthorized", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(403, { error: "forbidden", message: "Access denied" }));

			const client = new CodeTeleportClient({ apiUrl, token });
			await expect(client.listSessions()).rejects.toThrow("API error 403");
		});
	});

	describe("register", () => {
		it("calls POST /auth/register with email and password", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(201, { token: "jwt-token", user: { id: "u1", email: "a@b.com" } }));

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.register("a@b.com", "pass123");

			expect(mockFetch).toHaveBeenCalledWith(`${apiUrl}/auth/register`, expect.objectContaining({ method: "POST" }));
			expect(result.token).toBe("jwt-token");
			expect(result.user.email).toBe("a@b.com");
		});

		it("throws on failure", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(409, { message: "Email taken" }));

			const client = new CodeTeleportClient({ apiUrl, token });
			await expect(client.register("a@b.com", "pass123")).rejects.toThrow("Email taken");
		});
	});

	describe("login", () => {
		it("calls POST /auth/login", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(200, { token: "jwt", user: { id: "u1", email: "a@b.com" } }));

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.login("a@b.com", "pass123");

			expect(mockFetch).toHaveBeenCalledWith(`${apiUrl}/auth/login`, expect.objectContaining({ method: "POST" }));
			expect(result.token).toBe("jwt");
		});
	});

	describe("createApiToken", () => {
		it("calls POST /auth/token with auth header", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(201, { token: "ctk_live_new", id: "t1" }));

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.createApiToken("my-device");

			expect(mockFetch).toHaveBeenCalledWith(
				`${apiUrl}/auth/token`,
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
				}),
			);
			expect(result.token).toBe("ctk_live_new");
		});
	});

	describe("listSessions", () => {
		it("calls GET /sessions", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(200, { sessions: [], total: 0 }));

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.listSessions();

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/sessions"),
				expect.objectContaining({ method: "GET" }),
			);
			expect(result.sessions).toEqual([]);
		});

		it("passes query params for filtering", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(200, { sessions: [], total: 0 }));

			const client = new CodeTeleportClient({ apiUrl, token });
			await client.listSessions({ machine: "macbook", tag: "work", limit: 5 });

			const url = mockFetch.mock.calls[0][0] as string;
			expect(url).toContain("machine=macbook");
			expect(url).toContain("tag=work");
			expect(url).toContain("limit=5");
		});
	});

	describe("initiateUpload", () => {
		it("calls POST /sessions/upload", async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse(200, { uploadUrl: "https://r2.test/upload", sessionRecordId: "s1" }),
			);

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.initiateUpload({
				sessionId: "s1",
				sourceMachine: "macbook",
				sourceCwd: "/Users/alice/proj",
				sourceUserDir: "/Users/alice",
				sizeBytes: 1000,
				checksum: "sha256:abc",
				metadata: { messageCount: 10 },
			});

			expect(result.uploadUrl).toBe("https://r2.test/upload");
			expect(result.sessionRecordId).toBe("s1");
		});
	});

	describe("confirmUpload", () => {
		it("calls POST /sessions/:id/confirm", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));

			const client = new CodeTeleportClient({ apiUrl, token });
			await client.confirmUpload("s1");

			expect(mockFetch).toHaveBeenCalledWith(
				`${apiUrl}/sessions/s1/confirm`,
				expect.objectContaining({ method: "POST" }),
			);
		});
	});

	describe("getDownloadUrl", () => {
		it("calls GET /sessions/:id/download", async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse(200, {
					downloadUrl: "https://r2.test/download",
					session: { id: "s1", sourceCwd: "/a", sourceUserDir: "/b", sourceMachine: "mac", metadata: null },
				}),
			);

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.getDownloadUrl("s1");

			expect(result.downloadUrl).toBe("https://r2.test/download");
			expect(result.session.id).toBe("s1");
		});
	});

	describe("deleteSession", () => {
		it("calls DELETE /sessions/:id", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));

			const client = new CodeTeleportClient({ apiUrl, token });
			await client.deleteSession("s1");

			expect(mockFetch).toHaveBeenCalledWith(`${apiUrl}/sessions/s1`, expect.objectContaining({ method: "DELETE" }));
		});
	});

	describe("uploadBundle", () => {
		it("PUTs file to presigned URL", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

			// Create a real temp file so the implementation can read it
			const fs = await import("node:fs");
			const os = await import("node:os");
			const path = await import("node:path");
			const tmpFile = path.join(os.tmpdir(), `upload-test-${Date.now()}.tar.gz`);
			fs.writeFileSync(tmpFile, "fake bundle content");

			try {
				const client = new CodeTeleportClient({ apiUrl, token });
				await expect(client.uploadBundle("https://r2.test/put", tmpFile)).resolves.not.toThrow();
			} finally {
				fs.unlinkSync(tmpFile);
			}
		});
	});

	describe("downloadBundle", () => {
		it("downloads from presigned URL to file", async () => {
			mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

			const os = await import("node:os");
			const path = await import("node:path");
			const outFile = path.join(os.tmpdir(), `download-test-${Date.now()}.tar.gz`);

			const client = new CodeTeleportClient({ apiUrl, token });
			await expect(client.downloadBundle("https://r2.test/get", outFile)).resolves.not.toThrow();

			// Clean up
			const fs = await import("node:fs");
			try {
				fs.unlinkSync(outFile);
			} catch {}
		});
	});

	describe("getVersions", () => {
		it("returns version history for a session", async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse(200, {
					sessionId: "sess-001",
					currentVersion: 3,
					versions: [
						{ version: 3, sizeBytes: 5000, checksum: "sha256:ccc", createdAt: "2026-04-01T10:00:00Z" },
						{ version: 2, sizeBytes: 4000, checksum: "sha256:bbb", createdAt: "2026-03-31T08:00:00Z" },
					],
					limit: 2,
				}),
			);

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.getVersions("sess-001");
			expect(result.sessionId).toBe("sess-001");
			expect(result.currentVersion).toBe(3);
			expect(result.versions).toHaveLength(2);
			expect(result.limit).toBe(2);
		});
	});

	describe("getDownloadUrl with version", () => {
		it("passes version query param when specified", async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse(200, {
					downloadUrl: "https://r2.test/download",
					version: 2,
					session: { id: "sess-001", sourceCwd: "/test", sourceUserDir: "/test", sourceMachine: null, metadata: null },
				}),
			);

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.getDownloadUrl("sess-001", 2);
			expect(result.version).toBe(2);

			// Verify the URL includes version param
			const calledUrl = mockFetch.mock.calls[0][0];
			expect(calledUrl).toContain("version=2");
		});

		it("omits version param when not specified", async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse(200, {
					downloadUrl: "https://r2.test/download",
					version: 3,
					session: { id: "sess-001", sourceCwd: "/test", sourceUserDir: "/test", sourceMachine: null, metadata: null },
				}),
			);

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.getDownloadUrl("sess-001");
			expect(result.version).toBe(3);

			const calledUrl = mockFetch.mock.calls[0][0];
			expect(calledUrl).not.toContain("version=");
		});
	});

	describe("initiateUpload response", () => {
		it("returns version number from upload", async () => {
			mockFetch.mockResolvedValueOnce(
				mockResponse(200, { uploadUrl: "https://r2.test/upload", sessionRecordId: "sess-001", version: 2 }),
			);

			const client = new CodeTeleportClient({ apiUrl, token });
			const result = await client.initiateUpload({
				sessionId: "sess-001",
				sourceMachine: "test",
				sourceCwd: "/test",
				sourceUserDir: "/test",
				sizeBytes: 1000,
				checksum: "sha256:abc",
				metadata: { messageCount: 1 },
			});
			expect(result.version).toBe(2);
		});
	});
});
