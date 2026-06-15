#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { QuickJsExecutor } from './executor.js';
import { LexwareApiClient } from './lexware-client.js';
import { lexwareSpec } from './lexware-spec.js';
import { stringifyForMcp } from './truncate.js';

const server = new McpServer({
	name: 'lexware-office-v2',
	version: '1.5.0',
});

const searchExecutor = new QuickJsExecutor();
const executeExecutor = new QuickJsExecutor();
// Use a shorter per-request timeout than the executor timeout (30 s) so that
// slow Lexware requests fail with a clean error before the sandbox is torn down.
const lexwareClient = new LexwareApiClient({ requestTimeoutMs: 25_000 });

server.tool(
	'search',
	`Search the curated Lexware Office API catalog by running a JavaScript async arrow function.

Use this before execute to discover endpoints, request shapes, response notes, workflows, and domain-specific caveats.

Available global:

declare const spec: LexwareApiCatalog;

Useful starting points:
- spec.info.domainIndex: compact map from business domains to endpoint lists
- spec.paths: path -> method -> operation catalog with params, requestBody, responses, examples, capabilities, docsUrl
- spec.workflows: curated recipes for reporting, sales documents, files, webhooks, and API quirks
- spec.info.voucherStatusSemantics and financeReportingSemantics: finance/status guidance for revenue/Umsatz/profit questions

Sandbox: no network, filesystem, process, fetch, imports, or API key. Return JSON-serializable data; console logs are captured.

Examples:

async () => Object.entries(spec.info.domainIndex)
  .filter(([name, domain]) => [name, ...domain.tags].some(value => value.toLowerCase().includes('contact')))
  .map(([name, domain]) => ({ name, ...domain }))

async () => {
  const op = spec.paths['/v1/voucherlist']?.get;
  return { summary: op?.summary, parameters: op?.parameters, notes: op?.notes, examples: op?.examples };
}`,
	{
		code: z.string().describe('JavaScript async arrow function to search the Lexware API catalog'),
	},
	async ({ code }) => {
		const execution = await searchExecutor.execute(
			code,
			{ spec: lexwareSpec },
			{ timeoutMs: 1_000, memoryLimitBytes: 32 * 1024 * 1024, maxStackSizeBytes: 1024 * 1024, filename: 'lexware-search.js' },
		);

		if (execution.error) {
			return {
				content: [
					{
						type: 'text',
						text: stringifyForMcp({ ok: false, error: execution.error, logs: execution.logs ?? [] }),
					},
				],
				isError: true,
			};
		}

		return {
			content: [
				{
					type: 'text',
					text: stringifyForMcp({ ok: true, result: execution.result, logs: execution.logs ?? [] }),
				},
			],
		};
	},
);

server.tool(
	'execute',
	`Execute a constrained Lexware Office API workflow by running a JavaScript async arrow function.

Use search first when you need endpoint/domain guidance; do not guess Lexware paths from memory. The sandbox exposes no API key, filesystem, process, imports, fetch, or arbitrary network access.

Available globals:

declare const spec: LexwareApiCatalog;
declare const lexware: {
  request<T = unknown>(input: LexwareRequest): Promise<LexwareResponse<T>>;
  json(input: LexwareRequest): Promise<unknown>;
  paginate<T = unknown>(input: LexwareRequest, options?: { maxPages?: number }): Promise<T[]>;
  requireNumber(row: unknown, fieldPath: string): number;
  requireMoney(row: unknown, fieldPath: string): number;
  sumMoney(rows: unknown[], fieldPath: string): number;
  formatMoney(cents: number, currency?: string): string;
};

type LexwareRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // relative /v1/... only; no absolute URLs or // hosts
  query?: Record<string, string | number | boolean | Array<string | number | boolean> | null | undefined>;
  body?: unknown; // JSON by default; string when rawBody=true
  contentType?: string;
  rawBody?: boolean;
  accept?: string;
};

type LexwareResponse<T = unknown> = {
  ok: boolean;
  status: number;
  statusText: string;
  data?: T;
  text?: string;
  truncated?: boolean;
  contentType: string;
  headers: Record<string, string>;
  errorCategory?: string;
  retryAfterSeconds?: number;
  operation?: { operationId: string; method: string; pathTemplate: string; summary: string };
  request: { method: string; path: string; query: Record<string, string[]> };
};

lexware.request returns all HTTP responses, including non-OK, as LexwareResponse. Check response.ok/status for recovery logic, or use lexware.json(...) / lexware.paginate(...) when you want non-OK or non-JSON responses to throw.

v2 is read-only by default. POST, PUT, PATCH, and DELETE are blocked unless the server is started with LEXWARE_OFFICE_ALLOW_WRITES=true. Setting LEXWARE_OFFICE_READ_ONLY=true is a hard block that overrides ALLOW_WRITES.

Example:

async () => {
  const response = await lexware.request({ path: '/v1/contacts', query: { page: 0, size: 5 } });
  return { status: response.status, request: response.request, data: response.data };
}`,
	{
		code: z.string().describe('JavaScript async arrow function to execute a constrained Lexware API workflow'),
		maxRequests: z
			.number()
			.int()
			.min(1)
			.max(50)
			.optional()
			.default(10)
			.describe('Maximum number of Lexware API requests this execution may perform.'),
	},
	async ({ code, maxRequests }) => {
		let requestCount = 0;
		const execution = await executeExecutor.execute(
			code,
			{ spec: lexwareSpec },
			{
				timeoutMs: 30_000,
				memoryLimitBytes: 32 * 1024 * 1024,
				maxStackSizeBytes: 1024 * 1024,
				filename: 'lexware-execute.js',
				hostFunctions: {
					__lexwareRequestJson: async (payload) => {
						requestCount += 1;
						if (requestCount > maxRequests) {
							throw new Error(`Execution exceeded maxRequests=${maxRequests}`);
						}
						const request = JSON.parse(payload) as unknown;
						const response = await lexwareClient.request(request);
						return JSON.stringify(response);
					},
				},
			},
		);

		if (execution.error) {
			return {
				content: [
					{
						type: 'text',
						text: stringifyForMcp({ ok: false, error: execution.error, logs: execution.logs ?? [], requestCount }),
					},
				],
				isError: true,
			};
		}

		return {
			content: [
				{
					type: 'text',
					text: stringifyForMcp({ ok: true, result: execution.result, logs: execution.logs ?? [], requestCount }),
				},
			],
		};
	},
);

async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error('Fatal error in Lexware Office v2 MCP server:', error);
	process.exit(1);
});
