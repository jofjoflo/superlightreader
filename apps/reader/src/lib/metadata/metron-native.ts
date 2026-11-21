import { registerPlugin } from '@capacitor/core';

/** Android-only bridge. The native implementation never exposes the stored token. */
export interface MetronNativePlugin {
	status(): Promise<{ configured: boolean }>;
	hasToken(): Promise<{ configured: boolean }>;
	setToken(options: { token: string }): Promise<{ configured?: boolean; stored?: boolean }>;
	clearToken(): Promise<{ cleared?: boolean }>;
	search(options: { q?: string; query?: string; number?: string; volume?: number; year?: number; page: number }): Promise<unknown>;
	detail(options: { id: number | string }): Promise<unknown>;
}

export const MetronNative = registerPlugin<MetronNativePlugin>('Metron');

/** Accept both direct native JSON and the older `{ data: string }` envelope. */
export function parseNativeMetronResponse(response: unknown): unknown {
	if (!response || typeof response !== 'object' || Array.isArray(response)) return response;
	if (!Object.prototype.hasOwnProperty.call(response, 'data')) return response;
	const data = (response as { data?: unknown }).data;
	if (typeof data !== 'string' || !data.trim()) throw new Error('Metron returned an empty response');
	return JSON.parse(data);
}
