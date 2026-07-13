import { randomBytes, randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';

import { InvalidRequestError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000; // time allowed to complete the GitHub login
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type PendingAuthorization = {
	client: OAuthClientInformationFull;
	params: AuthorizationParams;
	createdAt: number;
};

type AuthorizationCodeData = {
	client: OAuthClientInformationFull;
	params: AuthorizationParams;
	githubLogin: string;
	createdAt: number;
};

type AccessTokenData = {
	clientId: string;
	scopes: string[];
	expiresAt: number;
	githubLogin: string;
};

/** In-memory registry of dynamically registered MCP clients (RFC 7591). */
class InMemoryClientsStore implements OAuthRegisteredClientsStore {
	private readonly clients = new Map<string, OAuthClientInformationFull>();

	async getClient(clientId: string) {
		return this.clients.get(clientId);
	}

	async registerClient(client: OAuthClientInformationFull) {
		this.clients.set(client.client_id, client);
		return client;
	}
}

export type GitHubOAuthProviderOptions = {
	clientId: string;
	clientSecret: string;
	/** This server's own callback URL, registered as the GitHub OAuth App's callback URL. */
	callbackUrl: string;
	/** GitHub OAuth scope requested. Defaults to 'read:user' (identity only, no repo access). */
	scope?: string;
	/** If set, only these GitHub logins (case-insensitive) may complete authorization. */
	allowedLogins?: string[];
};

/**
 * MCP OAuth authorization server backed by GitHub as the identity provider.
 *
 * All authorization state (pending logins, issued codes, issued access tokens, and
 * dynamically registered MCP clients) lives in process memory only — nothing is
 * persisted, so restarting the server invalidates every outstanding session.
 */
export class GitHubOAuthProvider implements OAuthServerProvider {
	readonly clientsStore = new InMemoryClientsStore();

	private readonly pendingAuthorizations = new Map<string, PendingAuthorization>();
	private readonly authorizationCodes = new Map<string, AuthorizationCodeData>();
	private readonly accessTokens = new Map<string, AccessTokenData>();

	constructor(private readonly options: GitHubOAuthProviderOptions) {
		setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS).unref();
	}

	private sweepExpired(): void {
		const now = Date.now();
		for (const [key, value] of this.pendingAuthorizations) {
			if (now - value.createdAt > PENDING_AUTH_TTL_MS) this.pendingAuthorizations.delete(key);
		}
		for (const [key, value] of this.authorizationCodes) {
			if (now - value.createdAt > PENDING_AUTH_TTL_MS) this.authorizationCodes.delete(key);
		}
		for (const [key, value] of this.accessTokens) {
			if (value.expiresAt < now) this.accessTokens.delete(key);
		}
	}

	/** Step 1: an MCP client hits our /authorize endpoint — send the user to GitHub instead. */
	async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
		if (!client.redirect_uris.includes(params.redirectUri)) {
			throw new InvalidRequestError('Unregistered redirect_uri');
		}

		const state = randomUUID();
		this.pendingAuthorizations.set(state, { client, params, createdAt: Date.now() });

		const githubUrl = new URL(GITHUB_AUTHORIZE_URL);
		githubUrl.searchParams.set('client_id', this.options.clientId);
		githubUrl.searchParams.set('redirect_uri', this.options.callbackUrl);
		githubUrl.searchParams.set('scope', this.options.scope ?? 'read:user');
		githubUrl.searchParams.set('state', state);

		res.redirect(githubUrl.toString());
	}

	/** Step 2: GitHub redirects the user back here after login — mount this at the callback route. */
	async handleGitHubCallback(req: Request, res: Response): Promise<void> {
		const query = req.query as Record<string, string | undefined>;
		const { code, state, error, error_description: errorDescription } = query;

		if (error) {
			res.status(400).send(`GitHub authorization failed: ${errorDescription ?? error}`);
			return;
		}
		if (!code || !state) {
			res.status(400).send('Missing code or state from GitHub callback.');
			return;
		}

		const pending = this.pendingAuthorizations.get(state);
		this.pendingAuthorizations.delete(state);
		if (!pending) {
			res.status(400).send('Unknown or expired authorization request — please retry from your MCP client.');
			return;
		}

		let githubAccessToken: string;
		let githubLogin: string;
		try {
			githubAccessToken = await this.exchangeGitHubCode(code);
			githubLogin = await this.fetchGitHubLogin(githubAccessToken);
		} catch (err) {
			res.status(502).send(`GitHub login failed: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		if (this.options.allowedLogins && !this.options.allowedLogins.some((login) => login.toLowerCase() === githubLogin.toLowerCase())) {
			res.status(403).send(`GitHub user "${githubLogin}" is not authorized to access this server.`);
			return;
		}

		const mcpCode = randomBytes(32).toString('hex');
		this.authorizationCodes.set(mcpCode, {
			client: pending.client,
			params: pending.params,
			githubLogin,
			createdAt: Date.now(),
		});

		const redirectUrl = new URL(pending.params.redirectUri);
		redirectUrl.searchParams.set('code', mcpCode);
		if (pending.params.state !== undefined) redirectUrl.searchParams.set('state', pending.params.state);

		res.redirect(redirectUrl.toString());
	}

	private async exchangeGitHubCode(code: string): Promise<string> {
		const response = await fetch(GITHUB_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({
				client_id: this.options.clientId,
				client_secret: this.options.clientSecret,
				code,
				redirect_uri: this.options.callbackUrl,
			}),
		});
		if (!response.ok) {
			throw new Error(`GitHub token endpoint returned ${response.status}`);
		}
		const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
		if (!data.access_token) {
			throw new Error(data.error_description ?? data.error ?? 'GitHub response did not include an access_token');
		}
		return data.access_token;
	}

	private async fetchGitHubLogin(githubAccessToken: string): Promise<string> {
		const response = await fetch(GITHUB_USER_URL, {
			headers: {
				Authorization: `Bearer ${githubAccessToken}`,
				'User-Agent': 'mcp-lexware-office',
				Accept: 'application/vnd.github+json',
			},
		});
		if (!response.ok) {
			throw new Error(`GitHub user endpoint returned ${response.status}`);
		}
		const data = (await response.json()) as { login?: string };
		if (!data.login) {
			throw new Error('GitHub user response did not include a login');
		}
		return data.login;
	}

	async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
		const codeData = this.authorizationCodes.get(authorizationCode);
		if (!codeData) {
			throw new InvalidRequestError('Invalid authorization code');
		}
		return codeData.params.codeChallenge;
	}

	async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
		const codeData = this.authorizationCodes.get(authorizationCode);
		if (!codeData) {
			throw new InvalidRequestError('Invalid authorization code');
		}
		if (codeData.client.client_id !== client.client_id) {
			throw new InvalidRequestError('Authorization code was not issued to this client');
		}
		this.authorizationCodes.delete(authorizationCode);

		const token = randomBytes(32).toString('hex');
		const scopes = codeData.params.scopes ?? [];
		this.accessTokens.set(token, {
			clientId: client.client_id,
			scopes,
			expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
			githubLogin: codeData.githubLogin,
		});

		return {
			access_token: token,
			token_type: 'bearer',
			expires_in: ACCESS_TOKEN_TTL_MS / 1000,
			scope: scopes.join(' '),
		};
	}

	async exchangeRefreshToken(): Promise<OAuthTokens> {
		throw new ServerError('Refresh tokens are not supported — re-authorize via GitHub once the access token expires.');
	}

	async verifyAccessToken(token: string): Promise<AuthInfo> {
		const tokenData = this.accessTokens.get(token);
		if (!tokenData || tokenData.expiresAt < Date.now()) {
			throw new Error('Invalid or expired token');
		}
		return {
			token,
			clientId: tokenData.clientId,
			scopes: tokenData.scopes,
			expiresAt: Math.floor(tokenData.expiresAt / 1000),
			extra: { githubLogin: tokenData.githubLogin },
		};
	}
}
