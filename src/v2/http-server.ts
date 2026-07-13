import { randomUUID } from 'node:crypto';

import cors from 'cors';

import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';

import { GitHubOAuthProvider } from './auth/github-oauth-provider.js';
import { createLexwareV2Server } from './server-factory.js';
import { logger } from '../logger.js';

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable ${name} for HTTP transport`);
	}
	return value;
}

export async function startHttpServer(): Promise<void> {
	const port = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : 3000;
	const host = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
	const publicUrl = new URL(process.env.MCP_PUBLIC_URL ?? `http://localhost:${port}`);
	const mcpEndpoint = new URL('/mcp', publicUrl);
	const callbackUrl = new URL('/callback/github', publicUrl);

	const allowedLogins = process.env.GITHUB_ALLOWED_LOGINS?.split(',')
		.map((login) => login.trim())
		.filter((login) => login.length > 0);

	const provider = new GitHubOAuthProvider({
		clientId: requireEnv('GITHUB_CLIENT_ID'),
		clientSecret: requireEnv('GITHUB_CLIENT_SECRET'),
		callbackUrl: callbackUrl.href,
		scope: process.env.GITHUB_OAUTH_SCOPE,
		allowedLogins: allowedLogins && allowedLogins.length > 0 ? allowedLogins : undefined,
	});

	const allowedHostsEnv = process.env.MCP_HTTP_ALLOWED_HOSTS?.split(',')
		.map((h) => h.trim())
		.filter((h) => h.length > 0);
	const app = createMcpExpressApp({ host, allowedHosts: allowedHostsEnv });

	// Browser-based MCP clients (e.g. MCP Inspector) call the OAuth metadata/token
	// endpoints and /mcp itself via fetch() from a different origin — without CORS
	// the preflight has no Access-Control-Allow-Origin and the browser blocks it
	// with an opaque "Failed to fetch". We use Bearer tokens, not cookies, so a
	// reflected origin without credentials is sufficient and simplest.
	app.use(
		cors({
			origin: true,
			exposedHeaders: ['Mcp-Session-Id'],
			allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Last-Event-ID', 'mcp-protocol-version'],
		}),
	);

	app.use(
		mcpAuthRouter({
			provider,
			issuerUrl: publicUrl,
			resourceServerUrl: mcpEndpoint,
			scopesSupported: ['mcp'],
			resourceName: 'Lexware Office MCP Server (v2)',
		}),
	);

	app.get('/callback/github', (req, res) => {
		provider.handleGitHubCallback(req, res).catch((err) => {
			logger.error('Error handling GitHub OAuth callback', err);
			if (!res.headersSent) res.status(500).send('Internal error during GitHub authorization.');
		});
	});

	const tokenVerifier: OAuthTokenVerifier = { verifyAccessToken: (token) => provider.verifyAccessToken(token) };
	const authMiddleware = requireBearerAuth({
		verifier: tokenVerifier,
		resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpEndpoint),
	});

	const transports: Record<string, StreamableHTTPServerTransport> = {};

	const mcpPostHandler = async (req: Request, res: Response): Promise<void> => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined;
		try {
			let transport: StreamableHTTPServerTransport;
			if (sessionId && transports[sessionId]) {
				transport = transports[sessionId];
			} else if (!sessionId && isInitializeRequest(req.body)) {
				transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					onsessioninitialized: (newSessionId) => {
						transports[newSessionId] = transport;
					},
				});
				transport.onclose = () => {
					const sid = transport.sessionId;
					if (sid) delete transports[sid];
				};
				const server = createLexwareV2Server();
				await server.connect(transport);
				await transport.handleRequest(req, res, req.body);
				return;
			} else {
				res.status(400).json({
					jsonrpc: '2.0',
					error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
					id: null,
				});
				return;
			}
			await transport.handleRequest(req, res, req.body);
		} catch (err) {
			logger.error('Error handling MCP request', err);
			if (!res.headersSent) {
				res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
			}
		}
	};

	const mcpGetOrDeleteHandler = async (req: Request, res: Response): Promise<void> => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined;
		if (!sessionId || !transports[sessionId]) {
			res.status(400).send('Invalid or missing session ID');
			return;
		}
		await transports[sessionId].handleRequest(req, res);
	};

	app.post('/mcp', authMiddleware, mcpPostHandler);
	app.get('/mcp', authMiddleware, mcpGetOrDeleteHandler);
	app.delete('/mcp', authMiddleware, mcpGetOrDeleteHandler);

	await new Promise<void>((resolve, reject) => {
		app.listen(port, host, (err?: Error) => {
			if (err) {
				reject(err);
				return;
			}
			const message = `Lexware Office v2 MCP server listening on http://${host}:${port}/mcp (public URL: ${mcpEndpoint.href})`;
			logger.log(message);
			// Safe to write to stdout here — unlike stdio transport, HTTP mode does not use stdout as the protocol channel.
			console.log(message);
			resolve();
		});
	});

	process.on('SIGINT', async () => {
		for (const sessionId of Object.keys(transports)) {
			await transports[sessionId].close().catch(() => undefined);
			delete transports[sessionId];
		}
		process.exit(0);
	});
}
