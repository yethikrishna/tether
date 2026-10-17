import { resolve } from 'node:path';
import { SqliteRunRepository } from '../src/store.js';
import { TetherOAuthProvider } from '../src/oauth-provider.js';
import { CloudflareOAuthHandoff } from '../src/oauth-handoff.js';
import { FO_ENDPOINT, prepareFoAuthorization } from '../src/fo-client.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

const configuredHandoffUrl = process.env.TETHER_OAUTH_HANDOFF_URL;
const handoffUrl = configuredHandoffUrl ?? 'https://tether-oauth-handoff.example.workers.dev';
const redirectUrl = process.env.TETHER_OAUTH_REDIRECT_URL ?? `${handoffUrl}/oauth/callback`;
const repository = new SqliteRunRepository({
  filename: resolve(process.env.TETHER_DATA_DIR ?? '.data', 'runs.sqlite'),
  keyFilename: resolve(process.env.TETHER_KEY_DIR ?? '.data', 'local-dev.key'),
});
const handoff = new CloudflareOAuthHandoff({ baseUrl: handoffUrl, repository });
const provider = new TetherOAuthProvider({ repository, redirectUrl, handoff });
const clientSummary = () => {
  const client = provider.clientInformation();
  return client ? { client_name: client.client_name, redirect_uris: client.redirect_uris, issuer: client.issuer } : null;
};

try {
  const action = process.argv[2];
  if (!configuredHandoffUrl) throw new Error('Set TETHER_OAUTH_HANDOFF_URL to the HTTPS workers.dev origin for this TETHER installation.');
  if (action === 'start') {
    if (provider.tokens()) throw new Error('TETHER already has saved OAuth tokens. No new consent flow was started.');
    const result = await prepareFoAuthorization({ provider, endpoint: FO_ENDPOINT });
    if (result.status === 'authorized' || !result.authorizationUrl) {
      throw new Error('Authorization completed without a browser step. Check the local token store before continuing.');
    }
    console.log(JSON.stringify({ status: result.status, authorizationUrl: result.authorizationUrl, client: clientSummary() }));
  } else if (action === 'finish') {
    const code = await provider.waitForAuthorizationCode({ timeoutMs: 120000 });
    const status = await auth(provider, { serverUrl: FO_ENDPOINT, authorizationCode: code, scope: 'mcp' });
    console.log(JSON.stringify({ status, hasTokens: Boolean(provider.tokens()), client: clientSummary() }));
  } else {
    throw new Error('Usage: node scripts/connect-fo.js start|finish');
  }
} catch (error) {
  console.error(error?.message || 'Fo connection failed.');
  process.exitCode = 1;
} finally {
  repository.close();
}
