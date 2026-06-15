import assert from 'node:assert/strict';
import test from 'node:test';

import { LexwareApiClient } from './lexware-client.js';

interface FetchCall {
	input: RequestInfo | URL;
	init?: RequestInit;
}

const clientWithFetch = (fetchImpl: typeof fetch, options: Partial<ConstructorParameters<typeof LexwareApiClient>[0]> = {}) => new LexwareApiClient({
	apiKey: 'test-key',
	baseUrl: 'https://example.test',
	rateLimitIntervalMs: 0,
	fetchImpl,
	...options,
});

const responseFor = (status: number, body: BodyInit | null, headers: HeadersInit = {}, statusText = '') => new Response(body, {
	status,
	statusText,
	headers,
});

test('401 JSON error is categorized as auth without exposing the API key', async () => {
	const calls: FetchCall[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		calls.push({ input, init });
		return responseFor(401, JSON.stringify({ message: 'unauthorized' }), { 'content-type': 'application/json' }, 'Unauthorized');
	};

	const response = await clientWithFetch(fetchImpl).request({ path: '/v1/countries' });

	assert.equal(response.ok, false);
	assert.equal(response.status, 401);
	assert.equal(response.errorCategory, 'auth');
	assert.deepEqual(response.data, { message: 'unauthorized' });
	assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
	assert.doesNotMatch(JSON.stringify(response), /test-key|Bearer/);
});

test('HTTP error statuses are categorized for model recovery decisions', async () => {
	const cases: Array<[number, string]> = [
		[403, 'permission'],
		[404, 'not_found'],
		[409, 'conflict'],
	];

	for (const [status, errorCategory] of cases) {
		const fetchImpl: typeof fetch = async () => responseFor(status, JSON.stringify({ status }), { 'content-type': 'application/json' });
		const response = await clientWithFetch(fetchImpl).request({ path: '/v1/countries' });
		assert.equal(response.ok, false);
		assert.equal(response.status, status);
		assert.equal(response.errorCategory, errorCategory);
	}
});

test('429 Retry-After seconds are surfaced', async () => {
	const fetchImpl: typeof fetch = async () => responseFor(429, JSON.stringify({ message: 'slow down' }), {
		'content-type': 'application/json',
		'retry-after': '30',
	}, 'Too Many Requests');

	const response = await clientWithFetch(fetchImpl).request({ path: '/v1/countries' });

	assert.equal(response.ok, false);
	assert.equal(response.errorCategory, 'rate_limit');
	assert.equal(response.retryAfterSeconds, 30);
});

test('429 Retry-After HTTP dates are converted to positive seconds', async () => {
	const retryDate = new Date(Date.now() + 60_000).toUTCString();
	const fetchImpl: typeof fetch = async () => responseFor(429, JSON.stringify({ message: 'slow down' }), {
		'content-type': 'application/json',
		'retry-after': retryDate,
	}, 'Too Many Requests');

	const response = await clientWithFetch(fetchImpl).request({ path: '/v1/countries' });

	assert.equal(response.ok, false);
	assert.equal(response.errorCategory, 'rate_limit');
	assert.ok(response.retryAfterSeconds !== undefined && response.retryAfterSeconds > 0 && response.retryAfterSeconds <= 60);
});

test('500 text/html error keeps the textual body', async () => {
	const fetchImpl: typeof fetch = async () => responseFor(500, '<html>boom</html>', { 'content-type': 'text/html' }, 'Internal Server Error');

	const response = await clientWithFetch(fetchImpl).request({ path: '/v1/countries' });

	assert.equal(response.ok, false);
	assert.equal(response.errorCategory, 'server');
	assert.equal(response.contentType, 'text/html');
	assert.equal(response.text, '<html>boom</html>');
});

test('malformed JSON response is returned as text and does not throw from request', async () => {
	const fetchImpl: typeof fetch = async () => responseFor(400, '{not valid json', { 'content-type': 'application/json' }, 'Bad Request');

	const response = await clientWithFetch(fetchImpl).request({ path: '/v1/countries' });

	assert.equal(response.ok, false);
	assert.equal(response.errorCategory, 'validation');
	assert.equal(response.text, '{not valid json');
	assert.equal(Object.prototype.hasOwnProperty.call(response, 'data'), false);
});

test('network errors use sanitized method/path messages', async () => {
	const fetchImpl: typeof fetch = async () => {
		throw new Error('failed to fetch https://example.test/v1/countries?secret=1 with Bearer test-key');
	};

	await assert.rejects(
		() => clientWithFetch(fetchImpl).request({ path: '/v1/countries' }),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /Lexware API network error for GET \/v1\/countries:/);
			assert.doesNotMatch(error.message, /secret=1|test-key|Bearer test-key|example\.test/);
			return true;
		},
	);
});

test('timeout errors use sanitized method/path messages', async () => {
	const fetchImpl: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
		const signal = init?.signal;
		if (!signal) reject(new Error('missing abort signal'));
		signal?.addEventListener('abort', () => {
			const error = new Error('aborted');
			error.name = 'AbortError';
			reject(error);
		}, { once: true });
	});

	await assert.rejects(
		() => clientWithFetch(fetchImpl, { requestTimeoutMs: 1 }).request({ path: '/v1/countries' }),
		/Lexware API request timed out after 1ms for GET \/v1\/countries/,
	);
});
