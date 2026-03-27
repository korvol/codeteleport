import fs from "node:fs";
import type { SessionMetadata } from "../shared/types";

export interface ApiClientOptions {
	apiUrl: string;
	token: string;
}

export interface SessionListItem {
	id: string;
	label: string | null;
	sourceMachine: string | null;
	sourceCwd: string;
	sourceUserDir: string;
	sizeBytes: number;
	metadata: SessionMetadata | null;
	createdAt: string;
	tags: string[];
}

export interface UploadInitResponse {
	uploadUrl: string;
	sessionRecordId: string;
}

export interface DownloadResponse {
	downloadUrl: string;
	session: {
		id: string;
		sourceCwd: string;
		sourceUserDir: string;
		sourceMachine: string | null;
		metadata: SessionMetadata | null;
	};
}

export class CodeTeleportClient {
	private baseUrl: string;
	private token: string;

	constructor(options: ApiClientOptions) {
		this.baseUrl = options.apiUrl;
		this.token = options.token;
	}

	private async request(method: string, path: string, body?: unknown): Promise<unknown> {
		const url = `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			method,
			headers: {
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!res.ok) {
			const error = (await res.json().catch(() => ({ message: res.statusText }))) as { message: string };
			throw new Error(`API error ${res.status}: ${error.message}`);
		}

		return res.json();
	}

	async register(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
		const res = await fetch(`${this.baseUrl}/auth/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});
		if (!res.ok) {
			const error = (await res.json().catch(() => ({ message: res.statusText }))) as { message: string };
			throw new Error(`Registration failed: ${error.message}`);
		}
		return res.json() as Promise<{ token: string; user: { id: string; email: string } }>;
	}

	async login(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
		const res = await fetch(`${this.baseUrl}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});
		if (!res.ok) {
			const error = (await res.json().catch(() => ({ message: res.statusText }))) as { message: string };
			throw new Error(`Login failed: ${error.message}`);
		}
		return res.json() as Promise<{ token: string; user: { id: string; email: string } }>;
	}

	async getMe(): Promise<{ id: string; email: string; plan: string; createdAt: string }> {
		return this.request("GET", "/auth/me") as Promise<{ id: string; email: string; plan: string; createdAt: string }>;
	}

	async getUsage(): Promise<{
		plan: string;
		paymentStatus: string | null;
		sessions: { used: number; limit: number | null };
		devices: { used: number; limit: number | null };
		versionsPerSession: number;
	}> {
		return this.request("GET", "/billing/usage") as Promise<{
			plan: string;
			paymentStatus: string | null;
			sessions: { used: number; limit: number | null };
			devices: { used: number; limit: number | null };
			versionsPerSession: number;
		}>;
	}

	async createApiToken(name: string, expiresIn = "never"): Promise<{ token: string; id: string }> {
		return this.request("POST", "/auth/token", { name, expiresIn }) as Promise<{ token: string; id: string }>;
	}

	async listSessions(params?: { machine?: string; tag?: string; limit?: number }): Promise<{
		sessions: SessionListItem[];
		total: number;
	}> {
		const query = new URLSearchParams();
		if (params?.machine) query.set("machine", params.machine);
		if (params?.tag) query.set("tag", params.tag);
		if (params?.limit) query.set("limit", params.limit.toString());
		const qs = query.toString();
		return this.request("GET", `/sessions${qs ? `?${qs}` : ""}`) as Promise<{
			sessions: SessionListItem[];
			total: number;
		}>;
	}

	async initiateUpload(data: {
		sessionId: string;
		sourceMachine: string;
		sourceCwd: string;
		sourceUserDir: string;
		sizeBytes: number;
		checksum: string;
		metadata: SessionMetadata;
		tags?: string[];
		label?: string;
	}): Promise<UploadInitResponse> {
		return this.request("POST", "/sessions/upload", data) as Promise<UploadInitResponse>;
	}

	async confirmUpload(sessionId: string): Promise<void> {
		await this.request("POST", `/sessions/${sessionId}/confirm`);
	}

	async getDownloadUrl(sessionId: string): Promise<DownloadResponse> {
		return this.request("GET", `/sessions/${sessionId}/download`) as Promise<DownloadResponse>;
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.request("DELETE", `/sessions/${sessionId}`);
	}

	async uploadBundle(presignedUrl: string, filePath: string): Promise<void> {
		const fileBuffer = fs.readFileSync(filePath);
		const res = await fetch(presignedUrl, {
			method: "PUT",
			body: fileBuffer,
			headers: { "Content-Type": "application/gzip" },
		});
		if (!res.ok) {
			throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
		}
	}

	async downloadBundle(presignedUrl: string, outputPath: string): Promise<void> {
		const res = await fetch(presignedUrl);
		if (!res.ok) {
			throw new Error(`Download failed: ${res.status} ${res.statusText}`);
		}
		const buffer = Buffer.from(await res.arrayBuffer());
		fs.writeFileSync(outputPath, buffer);
	}
}
