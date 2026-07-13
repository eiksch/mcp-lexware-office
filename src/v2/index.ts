#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createLexwareV2Server } from './server-factory.js';

async function main(): Promise<void> {
	if (process.env.MCP_TRANSPORT === 'http') {
		const { startHttpServer } = await import('./http-server.js');
		await startHttpServer();
		return;
	}

	const server = createLexwareV2Server();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error('Fatal error in Lexware Office v2 MCP server:', error);
	process.exit(1);
});
