import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://api.hirefinn.ai/v1';

type FinnContext = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

export interface FinnResponse {
	statusCode: number;
	body: IDataObject;
	headers: IDataObject;
}

export interface FinnRequestOptions {
	body?: IDataObject;
	qs?: IDataObject;
	headers?: IDataObject;
	/** Statuses of 400 or more the caller handles itself instead of getting an error. */
	allow?: number[];
}

// Finn answers errors as { error: "code", message } or { error: { code, message, required_scope } }.
export const errorOf = (statusCode: number, raw: unknown): { code: string; message: string; requiredScope?: string } => {
	let body = raw as IDataObject | string | undefined;
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body) as IDataObject;
		} catch (e) {
			body = {};
		}
	}
	const data = (body || {}) as IDataObject;
	const e = data.error as IDataObject | string | undefined;
	const obj = e && typeof e === 'object' ? e : undefined;
	const code = (obj ? obj.code : e) || data.code || `http_${statusCode}`;
	const message =
		(obj ? obj.message : data.message) || (typeof e === 'string' ? e : '') || `Finn answered ${statusCode}`;
	const requiredScope = obj && obj.required_scope ? String(obj.required_scope) : undefined;
	return { code: String(code), message: String(message), requiredScope };
};

/** A plain-language hint for the Finn errors a workflow builder can fix themselves. */
const hintFor = (statusCode: number, code: string, requiredScope?: string, retryAfter?: string): string | undefined => {
	if (statusCode === 401) return 'Your Finn API key was refused. Create a new key in Finn › Settings › API keys.';
	if (code === 'insufficient_scope')
		return `Give the API key the ${requiredScope ? `\`${requiredScope}\`` : 'missing'} scope in Finn › Settings › API keys.`;
	if (code === 'webhooks_api_not_enabled')
		return 'Webhooks are not on for this Finn workspace (feature v1_webhooks). Ask Finn support to turn them on.';
	if (statusCode === 429) return `Finn rate limit reached. Retry after ${retryAfter || 60} seconds.`;
	return undefined;
};

export async function finnRequest(
	this: FinnContext,
	method: IHttpRequestMethods,
	path: string,
	options: FinnRequestOptions = {},
): Promise<FinnResponse> {
	const credentials = await this.getCredentials('finnApi');
	const base = String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
	const request: IHttpRequestOptions = {
		method,
		url: `${base}${path}`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (options.body) request.body = options.body;
	if (options.qs) request.qs = options.qs;
	if (options.headers) request.headers = options.headers;

	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'finnApi', request)) as {
		statusCode: number;
		body: unknown;
		headers?: IDataObject;
	};
	const statusCode = Number(response.statusCode);
	const headers = (response.headers || {}) as IDataObject;
	const body = (response.body && typeof response.body === 'object' ? response.body : {}) as IDataObject;

	if (statusCode >= 400 && !(options.allow || []).includes(statusCode)) {
		const { code, message, requiredScope } = errorOf(statusCode, response.body);
		throw new NodeApiError(this.getNode(), { ...body, code } as JsonObject, {
			message,
			description: hintFor(statusCode, code, requiredScope, headers['retry-after'] as string | undefined),
			httpCode: String(statusCode),
		});
	}
	return { statusCode, body, headers };
}

/** First phone and email as plain fields, so a workflow can map them without picking from a list. */
export const flatContact = (c: unknown): IDataObject => {
	const contact = (c || {}) as IDataObject;
	const phones = contact.phones as string[] | undefined;
	const emails = contact.emails as string[] | undefined;
	return {
		...contact,
		phone: contact.phone || (Array.isArray(phones) ? phones[0] : undefined) || null,
		email: contact.email || (Array.isArray(emails) ? emails[0] : undefined) || null,
	};
};

/** Verifies X-Finn-Signature (t=<unix>,v1=<hex>[,v1=<hex>]) over `${t}.${body}` with the endpoint secret. */
export const signatureValid = (
	secret: string | undefined,
	header: string | undefined,
	body: string | undefined,
	toleranceSec = 600,
	now = Date.now(),
): boolean => {
	if (!secret || !header || typeof body !== 'string') return false;
	const parts = String(header)
		.split(',')
		.map((p) => p.trim().split('='));
	const t = Number((parts.find(([k]) => k === 't') || [])[1]);
	if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
	const want = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
	return parts
		.filter(([k]) => k === 'v1')
		.some(([, v]) => {
			const a = Buffer.from(String(v), 'utf8');
			const b = Buffer.from(want, 'utf8');
			return a.length === b.length && timingSafeEqual(a, b);
		});
};

/** `{ field: [{ key, value }] }` from a fixedCollection, as a plain object. Empty keys are skipped. */
export const keyValues = (collection: unknown): IDataObject => {
	const rows = ((collection || {}) as IDataObject).field as Array<{ key?: string; value?: unknown }> | undefined;
	const out: IDataObject = {};
	for (const row of rows || []) {
		if (row && row.key) out[row.key] = row.value as IDataObject[keyof IDataObject];
	}
	return out;
};

/** Tags typed as "a, b, c" or given as a list (from an expression). */
export const tagList = (v: unknown): string[] => {
	if (Array.isArray(v)) return v.map(String).map((t) => t.trim()).filter(Boolean);
	return String(v ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
};
