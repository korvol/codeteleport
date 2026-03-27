import { API_URL } from "../shared/constants";

/**
 * Resolve the API URL from CLI flag, falling back to the default.
 * Normalizes trailing slashes and ensures /v1 suffix.
 */
export function resolveApiUrl(flagValue?: string): string {
	if (!flagValue) return API_URL;

	let url = flagValue.replace(/\/+$/, "");
	if (!url.endsWith("/v1")) {
		url = `${url}/v1`;
	}
	return url;
}
