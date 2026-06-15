import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

import { QuickJsExecutor } from './executor.js';
import { LexwareApiClient } from './lexware-client.js';
import { lexwareSpec } from './lexware-spec.js';
import { stringifyForMcp, truncateText } from './truncate.js';

interface FetchCall {
	input: RequestInfo | URL;
	init?: RequestInit;
}

const responseFor = (status: number, body: BodyInit | null, headers: HeadersInit = {}, statusText = '') => new Response(body, {
	status,
	statusText,
	headers,
});

const clientWithCalls = (handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) => {
	const calls: FetchCall[] = [];
	const client = new LexwareApiClient({
		apiKey: 'test-key',
		baseUrl: 'https://example.test',
		rateLimitIntervalMs: 0,
		fetchImpl: async (input, init) => {
			calls.push({ input, init });
			return handler(input, init);
		},
	});
	return { client, calls };
};

test('v2 registers exactly search and execute tools', async () => {
	const source = await readFile('src/v2/index.ts', 'utf8');
	const tools = [...source.matchAll(/server\.tool\(\n\t'([^']+)'/g)].map((match) => match[1]);

	assert.deepEqual(tools, ['search', 'execute']);
	assert.doesNotMatch(source, /get-revenue-summary|allowWrite/);
	assert.match(source, /spec\.info\.domainIndex: compact map/);
	assert.match(source, /lexware\.request returns all HTTP responses/);
});

test('execute sandbox exposes generic request but not API key or Node globals', async () => {
	process.env.LEXWARE_OFFICE_API_KEY = 'super-secret-test-key';
	const execution = await new QuickJsExecutor().execute(
		`async () => ({
			lexwareType: typeof lexware,
			requestType: typeof lexware.request,
			processType: typeof process,
			fetchType: typeof fetch,
			requireType: typeof require,
			secretVisible: Object.getOwnPropertyNames(globalThis).join(',').includes('super-secret-test-key')
		})`,
		{ spec: {} },
		{
			hostFunctions: {
				__lexwareRequestJson: async () => JSON.stringify({ ok: true, status: 200, statusText: 'OK', request: { method: 'GET', path: '/v1/countries', query: {} }, contentType: 'application/json', headers: {}, data: {} }),
			},
		},
	);

	assert.equal(execution.error, undefined);
	assert.deepEqual(execution.result, {
		lexwareType: 'object',
		requestType: 'function',
		processType: 'undefined',
		fetchType: 'undefined',
		requireType: 'undefined',
		secretVisible: false,
	});
});

test('unknown relative /v1 paths are allowed and return request metadata without operation metadata', async () => {
	const { client, calls } = clientWithCalls(async () => responseFor(200, JSON.stringify({ ok: true }), { 'content-type': 'application/json' }, 'OK'));

	const response = await client.request({ path: '/v1/not-in-catalog?from=url', query: { q: 'search', repeated: [1, 2] } });

	assert.equal(response.ok, true);
	assert.equal(response.status, 200);
	assert.equal(response.operation, undefined);
	assert.deepEqual(response.request, {
		method: 'GET',
		path: '/v1/not-in-catalog',
		query: { from: ['url'], q: ['search'], repeated: ['1', '2'] },
	});
	assert.equal(String(calls[0]?.input), 'https://example.test/v1/not-in-catalog?from=url&q=search&repeated=1&repeated=2');
});

test('catalog matches include operation metadata but unknown query parameters no longer block execution', async () => {
	const { client } = clientWithCalls(async () => responseFor(200, JSON.stringify([]), { 'content-type': 'application/json' }, 'OK'));

	const response = await client.request({ path: '/v1/countries', query: { undocumented: true } });

	assert.equal(response.operation?.operationId, 'listCountries');
	assert.deepEqual(response.request.query, { undocumented: ['true'] });
});

test('absolute URLs, protocol-relative URLs, and /v1 escapes are rejected before fetch', async () => {
	const { client, calls } = clientWithCalls(async () => responseFor(200, '{}'));

	await assert.rejects(() => client.request({ path: 'https://evil.test/v1/countries' }), /path must start with \/|relative/);
	await assert.rejects(() => client.request({ path: '//evil.test/v1/countries' }), /relative to the Lexware API host/);
	await assert.rejects(() => client.request({ path: '/v1/../admin' }), /must resolve to \/v1\//);
	assert.equal(calls.length, 0);
});

test('writes do not need per-call allowWrite but honor process-wide read-only mode', async () => {
	const originalReadOnly = process.env.LEXWARE_OFFICE_READ_ONLY;
	const originalAllowWrites = process.env.LEXWARE_OFFICE_ALLOW_WRITES;
	try {
		delete process.env.LEXWARE_OFFICE_READ_ONLY;
		delete process.env.LEXWARE_OFFICE_ALLOW_WRITES;
		const { client, calls } = clientWithCalls(async () => responseFor(204, null, {}, 'No Content'));

		const response = await client.request({ method: 'PATCH', path: '/v1/custom-resource/123', body: { archived: true } });
		assert.equal(response.status, 204);
		assert.equal(calls[0]?.init?.method, 'PATCH');

		process.env.LEXWARE_OFFICE_READ_ONLY = 'true';
		await assert.rejects(() => client.request({ method: 'POST', path: '/v1/contacts', body: {} }), /blocked by LEXWARE_OFFICE_READ_ONLY/);
	} finally {
		if (originalReadOnly === undefined) delete process.env.LEXWARE_OFFICE_READ_ONLY;
		else process.env.LEXWARE_OFFICE_READ_ONLY = originalReadOnly;
		if (originalAllowWrites === undefined) delete process.env.LEXWARE_OFFICE_ALLOW_WRITES;
		else process.env.LEXWARE_OFFICE_ALLOW_WRITES = originalAllowWrites;
	}
});

test('JSON, custom content type, and raw body serialization are supported', async () => {
	const { client, calls } = clientWithCalls(async () => responseFor(200, JSON.stringify({ received: true }), { 'content-type': 'application/json' }, 'OK'));

	await client.request({ method: 'POST', path: '/v1/contacts', contentType: 'application/vnd.lexware+json', body: { name: 'Ada' } });
	assert.equal((calls[0]?.init?.headers as Record<string, string>)['Content-Type'], 'application/vnd.lexware+json');
	assert.equal(calls[0]?.init?.body, JSON.stringify({ name: 'Ada' }));

	const multipart = '--boundary\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\nhello\r\n--boundary--\r\n';
	await client.request({ method: 'POST', path: '/v1/files', query: { type: 'voucher' }, contentType: 'multipart/form-data; boundary=boundary', rawBody: true, body: multipart });
	assert.equal((calls[1]?.init?.headers as Record<string, string>)['Content-Type'], 'multipart/form-data; boundary=boundary');
	assert.equal(calls[1]?.init?.body, multipart);
});

test('large JSON responses stay parsed so execute code can summarize them', async () => {
	const rows = Array.from({ length: 5 }, (_, index) => ({ countryCode: `C${index}`, countryNameEN: 'x'.repeat(50) }));
	const client = new LexwareApiClient({
		apiKey: 'test-key',
		baseUrl: 'https://example.test',
		rateLimitIntervalMs: 0,
		maxResponseChars: 10,
		fetchImpl: async () => responseFor(200, JSON.stringify(rows), { 'content-type': 'application/json' }, 'OK'),
	});

	const response = await client.request({ path: '/v1/countries' });

	assert.deepEqual(response.data, rows);
	assert.equal(response.text, undefined);
	assert.equal(response.truncated, undefined);
});

test('text, binary metadata, and truncation recovery guidance are returned compactly', async () => {
	const textClient = clientWithCalls(async () => responseFor(200, 'plain text', { 'content-type': 'text/plain' }, 'OK')).client;
	const text = await textClient.request({ path: '/v1/custom-text', accept: 'text/plain' });
	assert.equal(text.text, 'plain text');

	const binaryClient = clientWithCalls(async () => responseFor(200, new Uint8Array([1, 2, 3]), { 'content-type': 'application/pdf' }, 'OK')).client;
	const binary = await binaryClient.request({ path: '/v1/files/file-id', accept: 'application/pdf' });
	assert.deepEqual(binary.data, { binary: true, contentType: 'application/pdf', bytes: 3, omitted: true });

	const defaultAcceptBinaryClient = clientWithCalls(async () => responseFor(200, new Uint8Array([1, 2, 3]), { 'content-type': 'application/pdf' }, 'OK')).client;
	const defaultAcceptBinary = await defaultAcceptBinaryClient.request({ path: '/v1/files/file-id' });
	assert.deepEqual(defaultAcceptBinary.data, { binary: true, contentType: 'application/pdf', bytes: 3, omitted: true });

	const truncated = truncateText('x'.repeat(50), { maxChars: 10 });
	assert.match(truncated, /truncated 40 characters/);
	assert.match(truncated, /Recovery: use a more specific search query/);

	const mcpOutput = stringifyForMcp({ data: 'x'.repeat(50) }, { maxChars: 20 });
	assert.match(mcpOutput, /summarize inside execute/);
});

test('search catalog exposes domain index and operation capability flags', () => {
	assert.ok(lexwareSpec.info.domainIndex.contacts);
	assert.deepEqual(lexwareSpec.info.domainIndex['payment-conditions'].endpoints, [{ method: 'GET', path: '/v1/payment-conditions' }]);
	assert.match(lexwareSpec.paths['/v1/payment-conditions']?.get?.summary ?? '', /payment terms/);
	assert.equal(lexwareSpec.paths['/v1/files']?.post?.capabilities?.multipart, true);
	assert.equal(lexwareSpec.paths['/v1/contacts']?.get?.capabilities?.paginated, true);
	assert.equal(lexwareSpec.paths['/v1/contacts']?.post?.capabilities?.write, true);
	assert.equal(lexwareSpec.paths['/v1/countries']?.get?.capabilities?.executable, true);
});
