import assert from 'node:assert/strict';
import test from 'node:test';

import { QuickJsExecutor } from './executor.js';

const executeWithLexware = (code: string) => new QuickJsExecutor().execute(
	code,
	{ spec: {} },
	{
		hostFunctions: {
			__lexwareRequestJson: async () => JSON.stringify({ ok: true, data: {} }),
		},
	},
);

const executeSearchMode = (code: string) => new QuickJsExecutor().execute(code, { spec: {} });

test('lexware.requireNumber accepts zero, numbers, numeric strings, and dotted paths', async () => {
	const execution = await executeWithLexware(`async () => ({
		zero: lexware.requireNumber({ openAmount: 0 }, 'openAmount'),
		number: lexware.requireNumber({ totalAmount: 12.34 }, 'totalAmount'),
		string: lexware.requireNumber({ totalAmount: '12.34' }, 'totalAmount'),
		dotted: lexware.requireNumber({ totalPrice: { totalNetAmount: 10 } }, 'totalPrice.totalNetAmount')
	})`);

	assert.equal(execution.error, undefined);
	assert.deepEqual(execution.result, {
		zero: 0,
		number: 12.34,
		string: 12.34,
		dotted: 10,
	});
});

test('lexware.requireNumber throws for missing fields and non-finite values', async () => {
	const execution = await executeWithLexware(`async () => {
		const capture = (fn) => {
			try {
				fn();
				return 'no error';
			} catch (error) {
				return error.message;
			}
		};
		return {
			missing: capture(() => lexware.requireNumber({}, 'totalAmount')),
			dottedMissing: capture(() => lexware.requireNumber({ totalPrice: {} }, 'totalPrice.totalNetAmount')),
			nonFinite: capture(() => lexware.requireNumber({ totalAmount: 'NaN' }, 'totalAmount')),
			infinite: capture(() => lexware.requireNumber({ totalAmount: Infinity }, 'totalAmount'))
		};
	}`);

	assert.equal(execution.error, undefined);
	assert.match((execution.result as { missing: string }).missing, /Missing expected field totalAmount/);
	assert.match((execution.result as { dottedMissing: string }).dottedMissing, /Missing expected field totalPrice\.totalNetAmount/);
	assert.match((execution.result as { nonFinite: string }).nonFinite, /Expected numeric totalAmount/);
	assert.match((execution.result as { infinite: string }).infinite, /Expected numeric totalAmount/);
});

test('lexware money helpers sum integer cents and format stable strings', async () => {
	const execution = await executeWithLexware(`async () => ({
		smallSum: lexware.sumMoney([{ amount: 0.1 }, { amount: 0.2 }], 'amount'),
		stringMoney: lexware.requireMoney({ amount: '60396.07' }, 'amount'),
		dottedMoney: lexware.requireMoney({ totalPrice: { totalNetAmount: '10.99' } }, 'totalPrice.totalNetAmount'),
		formatted: lexware.formatMoney(6039607),
		customCurrency: lexware.formatMoney(-123, 'USD')
	})`);

	assert.equal(execution.error, undefined);
	assert.deepEqual(execution.result, {
		smallSum: 30,
		stringMoney: 6039607,
		dottedMoney: 1099,
		formatted: 'EUR 60396.07',
		customCurrency: 'USD -1.23',
	});
});

test('lexware helpers are only available when the execute host function exists', async () => {
	const executeMode = await executeWithLexware(`async () => ({
		lexwareType: typeof lexware,
		requireNumberType: typeof lexware.requireNumber,
		sumMoneyType: typeof lexware.sumMoney
	})`);
	const searchMode = await executeSearchMode(`async () => ({
		lexwareType: typeof lexware,
		specType: typeof spec
	})`);

	assert.equal(executeMode.error, undefined);
	assert.deepEqual(executeMode.result, {
		lexwareType: 'object',
		requireNumberType: 'function',
		sumMoneyType: 'function',
	});

	assert.equal(searchMode.error, undefined);
	assert.deepEqual(searchMode.result, {
		lexwareType: 'undefined',
		specType: 'object',
	});
});
