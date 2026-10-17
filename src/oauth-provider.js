import { randomBytes } from 'node:crypto';

const REGISTRATION_KEY = 'fo.oauth.client-information';
const TOKEN_KEY = 'fo.oauth.tokens';
const VERIFIER_KEY = 'fo.oauth.code-verifier';
const STATE_KEY = 'fo.oauth.state';
const AUTH_URL_KEY = 'fo.oauth.authorization-url';
const DISCOVERY_KEY = 'fo.oauth.discovery-state';

/**
 * TETHER's own OAuth provider. Persist all OAuth state through the encrypted
 * local store. This client is distinct from MCP Inspector's existing grant.
 */
export class TetherOAuthProvider {
  constructor({ repository, redirectUrl = 'https://tether-oauth-handoff.example.workers.dev/oauth/callback', clientName = 'TETHER', handoff = null } = {}) {
    if (!repository) throw new TypeError('repository is required');
    const uri = new URL(redirectUrl);
    if (!['http:', 'https:'].includes(uri.protocol) || (uri.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(uri.hostname))) throw new Error('callback must use HTTPS or loopback HTTP');
    this.repository = repository;
    this.handoff = handoff;
    this._redirectUrl = uri.href;
    this._clientName = clientName;
  }
  get redirectUrl() { return this._redirectUrl; }
  get clientMetadata() {
    return {
      redirect_uris: [this._redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: this._clientName,
      scope: 'mcp',
    };
  }
  clientInformation() { return this.repository.getSecret(REGISTRATION_KEY); }
  saveClientInformation(info) { this.repository.setSecret(REGISTRATION_KEY, info); }
  tokens() { return this.repository.getSecret(TOKEN_KEY); }
  saveTokens(tokens) { this.repository.setSecret(TOKEN_KEY, tokens); }
  async state() {
    const state = randomBytes(32).toString('base64url');
    this.repository.setSecret(STATE_KEY, state);
    if (this.handoff) await this.handoff.arm(state);
    return state;
  }
  saveCodeVerifier(verifier) { this.repository.setSecret(VERIFIER_KEY, verifier); }
  codeVerifier() {
    const verifier = this.repository.getSecret(VERIFIER_KEY);
    if (typeof verifier !== 'string') throw new Error('OAuth PKCE verifier is missing');
    return verifier;
  }
  redirectToAuthorization(url) { this.repository.setSecret(AUTH_URL_KEY, new URL(url).href); }
  saveDiscoveryState(state) { this.repository.setSecret(DISCOVERY_KEY, state); }
  discoveryState() { return this.repository.getSecret(DISCOVERY_KEY); }
  getAuthorizationUrl() { return this.repository.getSecret(AUTH_URL_KEY); }
  getExpectedState() { return this.repository.getSecret(STATE_KEY); }
  async waitForAuthorizationCode(options = {}) {
    if (!this.handoff) throw new Error('OAuth callback handoff is not configured');
    const state = this.getExpectedState();
    const secret = this.repository.getSecret(`fo.oauth.handoff.${state}`);
    if (!state || typeof secret !== 'string') throw new Error('OAuth callback handoff is unavailable');
    try { return await this.handoff.take({ state, secret, ...options }); }
    finally {
      this.repository.deleteSecret(`fo.oauth.handoff.${state}`);
      this.repository.deleteSecret(STATE_KEY);
    }
  }
  clearPendingAuthorization() {
    this.repository.deleteSecret(STATE_KEY);
    this.repository.deleteSecret(VERIFIER_KEY);
    this.repository.deleteSecret(AUTH_URL_KEY);
  }
  clearAll() {
    for (const key of [REGISTRATION_KEY, TOKEN_KEY, VERIFIER_KEY, STATE_KEY, AUTH_URL_KEY, DISCOVERY_KEY]) this.repository.deleteSecret(key);
  }
}
