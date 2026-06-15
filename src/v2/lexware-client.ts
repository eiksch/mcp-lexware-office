import { lexwareSpec, type HttpMethod, type LexwareOperation } from './lexware-spec.js';
import { truncateText } from './truncate.js';

export type LexwareExecuteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type QueryScalar = string | number | boolean;
type QueryValue = QueryScalar | QueryScalar[] | null | undefined;

export interface LexwareRequestInput {
	method?: LexwareExecuteMethod | Lowercase<LexwareExecuteMethod>;
	path: string;
	query?: Record<string, QueryValue>;
	body?: unknown;
	contentType?: string;
	rawBody?: boolean;
	accept?: string;
}

export interface LexwareClientOptions {
	apiKey?: string;
	baseUrl?: string;
	userAgent?: string;
	fetchImpl?: typeof fetch;
	maxResponseChars?: number;
	requestTimeoutMs?: number;
	rateLimitIntervalMs?: number;
}

export interface LexwareRequestOptions {}

export interface LexwareResponse {
	ok: boolean;
	status: number;
	statusText: string;
	operation?: {
		operationId: string;
		method: LexwareExecuteMethod;
		pathTemplate: string;
		summary: string;
	};
	request: {
		method: LexwareExecuteMethod;
		path: string;
		query: Record<string, string[]>;
	};
	contentType: string;
	headers: Record<string, string>;
	errorCategory?: 'auth' | 'permission' | 'validation' | 'not_found' | 'conflict' | 'rate_limit' | 'server' | 'network' | 'unknown';
	retryAfterSeconds?: number;
	data?: unknown;
	text?: string;
	truncated?: boolean;
}

interface MatchedOperation {
	pathTemplate: string;
	operation: LexwareOperation;
}

interface NormalizedRequest {
	method: LexwareExecuteMethod;
	path: string;
	query: URLSearchParams;
	body?: unknown;
	contentType?: string;
	rawBody: boolean;
	accept: string;
	matched?: MatchedOperation;
}

const DEFAULT_BASE_URL = 'https://api.lexware.io';
const DEFAULT_USER_AGENT = 'mcp-lexware-office-v2/0.1.0';
const DEFAULT_MAX_RESPONSE_CHARS = 24_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_INTERVAL_MS = 500;
const WRITE_METHODS = new Set<LexwareExecuteMethod>(['POST', 'PUT', 'PATCH', 'DELETE']);

export class LexwareApiClient {
	private readonly apiKey?: string;
	private readonly baseUrl: string;
	private readonly userAgent: string;
	private readonly fetchImpl: typeof fetch;
	private readonly maxResponseChars: number;
	private readonly requestTimeoutMs: number;
	private readonly rateLimitIntervalMs: number;
	private nextRequestAtMs = 0;
	private rateLimitQueue: Promise<void> = Promise.resolve();

	constructor(options: LexwareClientOptions = {}) {
		this.apiKey = options.apiKey ?? process.env.LEXWARE_OFFICE_API_KEY;
		this.baseUrl = options.baseUrl ?? process.env.LEXWARE_OFFICE_API_BASE_URL ?? DEFAULT_BASE_URL;
		this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.maxResponseChars = options.maxResponseChars ?? DEFAULT_MAX_RESPONSE_CHARS;
		this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.rateLimitIntervalMs = options.rateLimitIntervalMs ?? DEFAULT_RATE_LIMIT_INTERVAL_MS;
	}

	async request(input: unknown, _options: LexwareRequestOptions = {}): Promise<LexwareResponse> {
		const apiKey = this.apiKey;
		if (!apiKey) {
			throw new Error('LEXWARE_OFFICE_API_KEY environment variable is required for the v2 execute tool');
		}

		const normalized = normalizeRequest(input);
		if (WRITE_METHODS.has(normalized.method) && writesAreGloballyDisabled()) {
			throw new Error(`${normalized.method} ${normalized.path} is blocked by LEXWARE_OFFICE_READ_ONLY/LEXWARE_OFFICE_ALLOW_WRITES configuration.`);
		}

		await this.waitForRateLimitTurn();

		const url = new URL(normalized.path, this.baseUrl);
		url.search = normalized.query.toString();

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
		try {
			const headers: Record<string, string> = {
				'User-Agent': this.userAgent,
				Accept: normalized.accept,
				Authorization: `Bearer ${apiKey}`,
			};

			const body = serializeRequestBody(normalized, headers);

			let response: Response;
			try {
				response = await this.fetchImpl(url, {
					method: normalized.method,
					headers,
					body,
					signal: controller.signal,
				});
			} catch (error) {
				if (controller.signal.aborted || isAbortError(error)) {
					throw new Error(`Lexware API request timed out after ${this.requestTimeoutMs}ms for ${normalized.method} ${normalized.path}`);
				}
				throw new Error(`Lexware API network error for ${normalized.method} ${normalized.path}: ${sanitizeFetchErrorMessage(error, apiKey)}`);
			}

			return await parseResponse(response, normalized, this.maxResponseChars);
		} finally {
			clearTimeout(timeout);
		}
	}

	private waitForRateLimitTurn(): Promise<void> {
		if (this.rateLimitIntervalMs <= 0) return Promise.resolve();

		const wait = this.rateLimitQueue.then(async () => {
			const now = Date.now();
			const delayMs = Math.max(0, this.nextRequestAtMs - now);
			if (delayMs > 0) await delay(delayMs);
			this.nextRequestAtMs = Date.now() + this.rateLimitIntervalMs;
		});
		this.rateLimitQueue = wait.catch(() => undefined);
		return wait;
	}
}

function normalizeRequest(input: unknown): NormalizedRequest {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('lexware.request expects an object: { method?, path, query?, body?, contentType?, rawBody?, accept? }');
	}

	const request = input as LexwareRequestInput;
	const method = normalizeMethod(request.method ?? 'GET');
	const rawPath = normalizePath(request.path);
	const accept = normalizeHeaderValue(request.accept ?? 'application/json', 'accept');
	const contentType = request.contentType === undefined ? undefined : normalizeHeaderValue(request.contentType, 'contentType');
	const rawBody = normalizeRawBody(request.rawBody ?? false);
	const url = new URL(rawPath, DEFAULT_BASE_URL);
	if (!url.pathname.startsWith('/v1/')) {
		throw new Error('path must resolve to /v1/ and must not escape that prefix');
	}
	const matched = matchOperation(url.pathname, method);

	if (method === 'GET' && request.body !== undefined) {
		throw new Error('GET requests must not include a body');
	}

	if (rawBody && request.body !== undefined && typeof request.body !== 'string') {
		throw new Error('rawBody=true requires body to be a string. Encode binary/multipart payloads as a string with an explicit contentType boundary.');
	}

	const query = new URLSearchParams(url.search);
	appendQueryObject(query, request.query);

	return {
		method,
		path: url.pathname,
		query,
		body: request.body,
		contentType,
		rawBody,
		accept,
		matched,
	};
}

function normalizeMethod(method: unknown): LexwareExecuteMethod {
	if (typeof method !== 'string') throw new Error('method must be a string');
	const normalized = method.toUpperCase();
	if (normalized !== 'GET' && normalized !== 'POST' && normalized !== 'PUT' && normalized !== 'PATCH' && normalized !== 'DELETE') {
		throw new Error(`Unsupported method: ${method}`);
	}
	return normalized;
}

function normalizePath(path: unknown): string {
	if (typeof path !== 'string' || path.length === 0) throw new Error('path must be a non-empty string');
	if (!path.startsWith('/')) throw new Error('path must start with / and must not include a host');
	if (path.startsWith('//') || path.includes('://')) throw new Error('path must be relative to the Lexware API host');
	if (!path.startsWith('/v1/')) throw new Error('path must start with /v1/');
	return path;
}

function normalizeRawBody(rawBody: unknown): boolean {
	if (typeof rawBody !== 'boolean') throw new Error('rawBody must be a boolean when provided');
	return rawBody;
}

function normalizeHeaderValue(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
	if (/\r|\n/.test(value)) throw new Error(`${field} must not contain newlines`);
	if (value.length > 500) throw new Error(`${field} is too long`);
	return value.trim();
}

function appendQueryObject(query: URLSearchParams, queryObject: unknown): void {
	if (queryObject === undefined) return;
	if (!queryObject || typeof queryObject !== 'object' || Array.isArray(queryObject)) {
		throw new Error('query must be an object of string, number, boolean, or array values');
	}

	for (const [key, value] of Object.entries(queryObject as Record<string, QueryValue>)) {
		if (value === undefined || value === null) continue;
		const values = Array.isArray(value) ? value : [value];
		for (const item of values) {
			if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
				throw new Error(`query.${key} must be a string, number, boolean, or an array of those values`);
			}
			query.append(key, String(item));
		}
	}
}

function matchOperation(pathname: string, method: LexwareExecuteMethod): MatchedOperation | undefined {
	const methodKey = method.toLowerCase() as HttpMethod;
	for (const [pathTemplate, methods] of Object.entries(lexwareSpec.paths)) {
		const operation = methods[methodKey];
		if (!operation) continue;
		if (pathTemplateToRegex(pathTemplate).test(pathname)) {
			return { pathTemplate, operation };
		}
	}
	return undefined;
}

function pathTemplateToRegex(template: string): RegExp {
	const pattern = template
		.split('/')
		.map((segment) => (segment.startsWith('{') && segment.endsWith('}') ? '[^/]+' : escapeRegex(segment)))
		.join('/');
	return new RegExp(`^${pattern}$`);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeRequestBody(request: NormalizedRequest, headers: Record<string, string>): BodyInit | undefined {
	if (request.body === undefined) return undefined;

	if (request.rawBody) {
		headers['Content-Type'] = request.contentType ?? 'application/octet-stream';
		return request.body as string;
	}

	const contentType = request.contentType ?? 'application/json';
	headers['Content-Type'] = contentType;
	if (isJsonContentType(contentType)) {
		return JSON.stringify(request.body);
	}
	if (typeof request.body === 'string') {
		return request.body;
	}
	throw new Error('Non-JSON request bodies must be strings or use rawBody=true with an explicit contentType.');
}

function isJsonContentType(contentType: string): boolean {
	const lower = contentType.toLowerCase();
	return lower === 'application/json' || lower.endsWith('+json') || lower.includes('/json');
}

async function parseResponse(response: Response, request: NormalizedRequest, maxResponseChars: number): Promise<LexwareResponse> {
	const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
	const headers = headersToObject(response.headers);
	const base: Omit<LexwareResponse, 'data' | 'text' | 'truncated'> = {
		ok: response.ok,
		status: response.status,
		statusText: response.statusText,
		...(request.matched ? {
			operation: {
				operationId: request.matched.operation.operationId,
				method: request.method,
				pathTemplate: request.matched.pathTemplate,
				summary: request.matched.operation.summary,
			},
		} : {}),
		request: {
			method: request.method,
			path: request.path,
			query: queryToObject(request.query),
		},
		contentType,
		headers,
	};

	if (!response.ok) {
		base.errorCategory = categorizeStatus(response.status) ?? 'unknown';
		if (response.status === 429) {
			const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
			if (retryAfterSeconds !== undefined) base.retryAfterSeconds = retryAfterSeconds;
		}
	}

	if (response.status === 204) return base;

	const isTextual = isTextualResponse(contentType, request.accept);
	if (!isTextual) {
		const bytes = await response.arrayBuffer();
		return {
			...base,
			data: {
				binary: true,
				contentType: contentType || 'application/octet-stream',
				bytes: bytes.byteLength,
				omitted: true,
			},
		};
	}

	const text = await response.text();

	if (isJsonResponse(contentType, request.accept)) {
		try {
			return { ...base, data: text.length > 0 ? JSON.parse(text) : null };
		} catch {
			// Fall through to compact text handling for malformed JSON responses.
		}
	}

	const truncated = text.length > maxResponseChars;
	const safeText = truncated ? truncateText(text, { maxChars: maxResponseChars }) : text;
	return { ...base, text: safeText, truncated };
}

function isTextualResponse(contentType: string, accept: string): boolean {
	const lowerContentType = contentType.toLowerCase();
	if (lowerContentType) {
		return lowerContentType.includes('json') || lowerContentType.startsWith('text/') || lowerContentType.includes('xml');
	}

	const lowerAccept = accept.toLowerCase();
	return lowerAccept.includes('json') || lowerAccept.includes('text/') || lowerAccept.includes('xml');
}

function isJsonResponse(contentType: string, accept: string): boolean {
	const lowerContentType = contentType.toLowerCase();
	if (lowerContentType) return lowerContentType.includes('json');
	return accept.toLowerCase().includes('json');
}

function categorizeStatus(status: number): LexwareResponse['errorCategory'] | undefined {
	if (status === 400 || status === 422) return 'validation';
	if (status === 401) return 'auth';
	if (status === 403) return 'permission';
	if (status === 404) return 'not_found';
	if (status === 409) return 'conflict';
	if (status === 429) return 'rate_limit';
	if (status >= 500 && status <= 599) return 'server';
	if (status < 200 || status >= 300) return 'unknown';
	return undefined;
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed);

	const retryDateMs = Date.parse(trimmed);
	if (!Number.isFinite(retryDateMs)) return undefined;
	const seconds = Math.ceil((retryDateMs - Date.now()) / 1000);
	return seconds > 0 ? seconds : undefined;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function sanitizeFetchErrorMessage(error: unknown, apiKey: string): string {
	const rawMessage = error instanceof Error ? error.message : String(error);
	const message = rawMessage.length > 0 ? rawMessage : 'unknown error';
	return message
		.replaceAll(apiKey, '[redacted]')
		.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
		.replace(/https?:\/\/[^\s)]+/gi, '[url omitted]');
}

function writesAreGloballyDisabled(): boolean {
	return process.env.LEXWARE_OFFICE_READ_ONLY === 'true' || process.env.LEXWARE_OFFICE_ALLOW_WRITES === 'false';
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function headersToObject(headers: Headers): Record<string, string> {
	const object: Record<string, string> = {};
	headers.forEach((value, key) => {
		object[key] = value;
	});
	return object;
}

function queryToObject(query: URLSearchParams): Record<string, string[]> {
	const object: Record<string, string[]> = {};
	query.forEach((value, key) => {
		object[key] ??= [];
		object[key].push(value);
	});
	return object;
}
