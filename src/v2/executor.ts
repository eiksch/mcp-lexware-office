import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

export interface CodeExecutor {
	execute(
		code: string,
		capabilities: Record<string, unknown>,
		options?: CodeExecutorOptions,
	): Promise<CodeExecutionResult>;
}

export type SandboxHostFunction = (payload: string) => Promise<string>;

export interface CodeExecutorOptions {
	timeoutMs?: number;
	memoryLimitBytes?: number;
	maxStackSizeBytes?: number;
	maxLogEntries?: number;
	maxLogChars?: number;
	filename?: string;
	hostFunctions?: Record<string, SandboxHostFunction>;
}

export interface CodeExecutionResult {
	result?: unknown;
	error?: string;
	logs?: string[];
}

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_STACK_SIZE_BYTES = 1024 * 1024;
const DEFAULT_MAX_LOG_ENTRIES = 25;
const DEFAULT_MAX_LOG_CHARS = 8_000;

export class QuickJsExecutor implements CodeExecutor {
	async execute(
		code: string,
		capabilities: Record<string, unknown>,
		options: CodeExecutorOptions = {},
	): Promise<CodeExecutionResult> {
		const QuickJS = await getQuickJS();
		const runtime = QuickJS.newRuntime();
		const vm = runtime.newContext();
		const logs: string[] = [];

		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const memoryLimitBytes = options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES;
		const maxStackSizeBytes = options.maxStackSizeBytes ?? DEFAULT_MAX_STACK_SIZE_BYTES;
		const maxLogEntries = options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;
		const maxLogChars = options.maxLogChars ?? DEFAULT_MAX_LOG_CHARS;
		const filename = options.filename ?? 'lexware-code.js';

		runtime.setMemoryLimit(memoryLimitBytes);
		runtime.setMaxStackSize(maxStackSizeBytes);
		runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));

		try {
			for (const [name, handler] of Object.entries(options.hostFunctions ?? {})) {
				vm.newFunction(name, (payloadHandle) => {
					const payload = vm.getString(payloadHandle);
					const deferred = vm.newPromise();
					handler(payload)
						.then(
							(result) => {
								const resultHandle = vm.newString(result);
								deferred.resolve(resultHandle);
								resultHandle.dispose();
							},
							(error) => {
								const errorHandle = vm.newError({ name: 'Error', message: stringifyHostError(error) });
								deferred.reject(errorHandle);
								errorHandle.dispose();
							},
						)
						.catch(() => undefined);
					deferred.settled
						.then(() => runtime.executePendingJobs())
						.catch(() => undefined);
					return deferred.handle;
				}).consume((hostFunctionHandle) => {
					vm.setProp(vm.global, name, hostFunctionHandle);
				});
			}

			vm.newFunction('log', (...args) => {
				if (logs.length >= maxLogEntries) return;
				const message = args.map((arg) => stringifyLogValue(vm.dump(arg))).join(' ');
				logs.push(message.length > maxLogChars ? `${message.slice(0, maxLogChars)}...[truncated]` : message);
			}).consume((logHandle) => {
				const consoleHandle = vm.newObject();
				vm.setProp(consoleHandle, 'log', logHandle);
				vm.setProp(consoleHandle, 'info', logHandle);
				vm.setProp(consoleHandle, 'warn', logHandle);
				vm.setProp(consoleHandle, 'error', logHandle);
				vm.setProp(vm.global, 'console', consoleHandle);
				consoleHandle.dispose();
			});

			const capabilitiesJson = JSON.stringify(capabilities);
			vm.newString(capabilitiesJson).consume((capabilitiesHandle) => {
				vm.setProp(vm.global, '__capabilitiesJson', capabilitiesHandle);
			});

			const wrappedCode = `
"use strict";
(async () => {
  const __capabilities = JSON.parse(globalThis.__capabilitiesJson);
  const { spec } = __capabilities;
  const lexware = typeof globalThis.__lexwareRequestJson === "function"
    ? (() => {
        const request = async (input) => JSON.parse(await globalThis.__lexwareRequestJson(JSON.stringify(input ?? {})));
        const assertOkJsonResponse = (response, helperName) => {
          if (!response || typeof response !== "object") {
            throw new Error(helperName + " expected lexware.request to return a LexwareResponse object");
          }
          if (response.ok === false) {
            const operation = response.operation
              ? response.operation.operationId + " (" + response.operation.method + " " + response.operation.pathTemplate + ")"
              : "unknown operation";
            const details = Object.prototype.hasOwnProperty.call(response, "data") ? response.data : response.text;
            const metadata = [];
            if (response.errorCategory) {
              metadata.push("Category: " + response.errorCategory + ".");
            }
            if (response.retryAfterSeconds !== undefined) {
              metadata.push("Retry after: " + response.retryAfterSeconds + "s.");
            }
            const metadataText = metadata.length > 0 ? " " + metadata.join(" ") : "";
            throw new Error("Lexware API request failed: " + response.status + " " + (response.statusText || "") + " for " + operation + "." + metadataText + " Error body: " + JSON.stringify(details));
          }
          if (!Object.prototype.hasOwnProperty.call(response, "data")) {
            throw new Error(helperName + " expected parsed JSON at response.data, but this response has no data property. Use lexware.request for status/header-aware, empty, text, XML, PDF, or binary responses. contentType=" + (response.contentType || "unknown"));
          }
          return response.data;
        };
        const json = async (input) => assertOkJsonResponse(await request(input), "lexware.json");
        const isObjectLike = (value) => value !== null && typeof value === "object";
        const getPathValue = (row, fieldPath) => {
          if (typeof fieldPath !== "string" || fieldPath.length === 0) {
            throw new Error("fieldPath must be a non-empty string");
          }
          const parts = fieldPath.split(".");
          let current = row;
          for (const part of parts) {
            if (!isObjectLike(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
              return {
                found: false,
                availableFields: isObjectLike(current) ? Object.keys(current).join(", ") : ""
              };
            }
            current = current[part];
          }
          return { found: true, value: current };
        };
        const requireNumber = (row, fieldPath) => {
          const result = getPathValue(row, fieldPath);
          if (!result.found) {
            throw new Error("Missing expected field " + fieldPath + ". Available fields: " + result.availableFields);
          }
          const value = Number(result.value);
          if (!Number.isFinite(value)) {
            throw new Error("Expected numeric " + fieldPath + ", got " + JSON.stringify(result.value));
          }
          return value;
        };
        const decimalStringPattern = /^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)$/;
        const decimalStringToCents = (input) => {
          const trimmed = input.trim();
          const sign = trimmed[0] === "-" ? -1 : 1;
          const unsigned = trimmed[0] === "-" || trimmed[0] === "+" ? trimmed.slice(1) : trimmed;
          const parts = unsigned.split(".");
          const whole = parts[0] === "" ? "0" : parts[0];
          const fraction = parts[1] || "";
          let cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
          if ((fraction[2] || "0") >= "5") {
            cents += 1;
          }
          return sign * cents;
        };
        const toCents = (value) => {
          const numericValue = Number(value);
          if (!Number.isFinite(numericValue)) {
            throw new Error("Expected finite money value, got " + JSON.stringify(value));
          }
          const decimalText = typeof value === "string" ? value.trim() : String(value);
          if (decimalStringPattern.test(decimalText)) {
            return decimalStringToCents(decimalText);
          }
          return Math.round(numericValue * 100 + (numericValue >= 0 ? Number.EPSILON : -Number.EPSILON));
        };
        const requireMoney = (row, fieldPath) => {
          const result = getPathValue(row, fieldPath);
          if (!result.found) {
            throw new Error("Missing expected field " + fieldPath + ". Available fields: " + result.availableFields);
          }
          requireNumber(row, fieldPath);
          return toCents(result.value);
        };
        const sumMoney = (rows, fieldPath) => {
          if (!Array.isArray(rows)) {
            throw new Error("lexware.sumMoney expects an array of rows");
          }
          return rows.reduce((sum, row) => sum + requireMoney(row, fieldPath), 0);
        };
        const formatMoney = (cents, currency = "EUR") => {
          const numericCents = Number(cents);
          if (!Number.isFinite(numericCents) || !Number.isInteger(numericCents)) {
            throw new Error("lexware.formatMoney expects integer cents, got " + JSON.stringify(cents));
          }
          const sign = numericCents < 0 ? "-" : "";
          const absoluteCents = Math.abs(numericCents);
          const whole = Math.floor(absoluteCents / 100);
          const fraction = String(absoluteCents % 100).padStart(2, "0");
          return String(currency) + " " + sign + whole + "." + fraction;
        };
        const paginate = async (input, options = {}) => {
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new Error("lexware.paginate expects an object: { path, query?, method? }");
          }
          const method = String(input.method || "GET").toUpperCase();
          if (method !== "GET") {
            throw new Error("lexware.paginate only supports GET list endpoints");
          }
          if (options == null || typeof options !== "object" || Array.isArray(options)) {
            throw new Error("lexware.paginate options must be an object when provided");
          }
          const maxPages = options.maxPages === undefined ? Infinity : Number(options.maxPages);
          if (!(maxPages === Infinity || (Number.isInteger(maxPages) && maxPages >= 1))) {
            throw new Error("lexware.paginate options.maxPages must be a positive integer");
          }
          const originalQuery = input.query == null ? {} : input.query;
          if (typeof originalQuery !== "object" || Array.isArray(originalQuery)) {
            throw new Error("lexware.paginate input.query must be an object when provided");
          }
          const baseQuery = { ...originalQuery };
          let page = baseQuery.page === undefined || baseQuery.page === null ? 0 : Number(baseQuery.page);
          if (!Number.isInteger(page) || page < 0) {
            throw new Error("lexware.paginate query.page must be a zero-based non-negative integer");
          }
          const size = baseQuery.size === undefined || baseQuery.size === null ? 250 : baseQuery.size;
          const items = [];
          let pagesFetched = 0;
          while (pagesFetched < maxPages) {
            const response = await request({ ...input, method: "GET", query: { ...baseQuery, page, size } });
            const data = assertOkJsonResponse(response, "lexware.paginate");
            if (!data || typeof data !== "object" || !Array.isArray(data.content)) {
              throw new Error("lexware.paginate expected response.data.content to be an array. Use lexware.request/json for non-paged endpoints.");
            }
            items.push(...data.content);
            pagesFetched += 1;
            if (data.last === true) break;
            if (typeof data.totalPages === "number" && page + 1 >= data.totalPages) break;
            if (data.content.length === 0) break;
            page += 1;
          }
          return items;
        };
        return Object.freeze({
          request,
          json,
          paginate,
          requireNumber,
          requireMoney,
          sumMoney,
          formatMoney
        });
      })()
    : undefined;
  const __userFunction = (${code});
  if (typeof __userFunction !== "function") {
    throw new Error("Code must evaluate to a function, for example: async () => ({ ok: true })");
  }
  return await __userFunction();
})()
`;

			const evaluation = vm.evalCode(wrappedCode, filename, { type: 'global' });
			if (evaluation.error) {
				const error = stringifyQuickJsError(vm.dump(evaluation.error));
				evaluation.error.dispose();
				return { error, logs };
			}

			const promiseHandle = evaluation.value;
			let resolved;
			try {
				const nativePromise = vm.resolvePromise(promiseHandle);
				const pendingJobsResult = runtime.executePendingJobs();
				if (pendingJobsResult.error) {
					const error = stringifyQuickJsError(vm.dump(pendingJobsResult.error));
					pendingJobsResult.error.dispose();
					promiseHandle.dispose();
					return { error, logs };
				}
				resolved = await withTimeout(nativePromise, timeoutMs);
				promiseHandle.dispose();
			} catch (error) {
				promiseHandle.dispose();
				return { error: String(error), logs };
			}

			if (resolved.error) {
				const error = stringifyQuickJsError(vm.dump(resolved.error));
				resolved.error.dispose();
				return { error, logs };
			}

			const result = vm.dump(resolved.value);
			resolved.value.dispose();
			return { result, logs };
		} finally {
			vm.dispose();
			runtime.dispose();
		}
	}
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeout);
				reject(error);
			},
		);
	});
}

function stringifyLogValue(value: unknown): string {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function stringifyHostError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return stringifyLogValue(error);
}

function stringifyQuickJsError(value: unknown): string {
	if (value && typeof value === 'object') {
		const maybeError = value as { name?: unknown; message?: unknown; stack?: unknown };
		const name = typeof maybeError.name === 'string' ? maybeError.name : 'Error';
		const message = typeof maybeError.message === 'string' ? maybeError.message : stringifyLogValue(value);
		const stack = typeof maybeError.stack === 'string' ? `\n${maybeError.stack}` : '';
		return `${name}: ${message}${stack}`;
	}
	return stringifyLogValue(value);
}
