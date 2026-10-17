import test from 'node:test';
import assert from 'node:assert/strict';
import { FoMcpClient } from '../src/fo-client.js';
import { SqliteRunRepository } from '../src/store.js';
import { TetherOAuthProvider } from '../src/oauth-provider.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function storage() {
  const root = mkdtempSync(join(tmpdir(), 'tether-oauth-'));
  const repository = new SqliteRunRepository({ filename: join(root, 'runs.sqlite'), keyFilename: join(root, 'key') });
  return { root, repository, close() { repository.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('SDK adapter sends only scoped tool args and decodes structured Fo result', async () => {
  const calls = [];
  const client = { async callTool(params) { calls.push(params); return { isError: false, structuredContent: { status: 'working', response: 'Working.', conversationId: 'cid' } }; } };
  const adapter = new FoMcpClient({ client, transport: { async close() {} } });
  assert.deepEqual(await adapter.askFo({ message: 'hello', newConversation: true }), { status: 'working', response: 'Working.', conversationId: 'cid' });
  assert.deepEqual(calls[0], { name: 'ask_fo', arguments: { message: 'hello', newConversation: true } });
  await adapter.getFoReply({ conversationId: 'cid', waitSeconds: 0 });
  assert.deepEqual(calls[1], { name: 'get_fo_reply', arguments: { waitSeconds: 0, conversationId: 'cid' } });
  await adapter.close();
});

test('OAuth registration metadata is TETHER-specific and secrets are encrypted at rest', (t) => {
  const data = storage(); t.after(data.close);
  const provider = new TetherOAuthProvider({ repository: data.repository });
  assert.deepEqual(provider.clientMetadata, {
    redirect_uris: ['https://tether-oauth-handoff.example.workers.dev/oauth/callback'], token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'TETHER', scope: 'mcp',
  });
  provider.saveClientInformation({ client_id: 'id', client_secret: 'test_secret' });
  provider.saveTokens({ access_token: 'access-test', refresh_token: 'refresh-test' });
  const bytes = readFileSync(join(data.root, 'runs.sqlite')).toString('utf8');
  assert.doesNotMatch(bytes, /test_secret|access-test|refresh-test/);
  assert.equal(provider.clientInformation().client_name, undefined);
  assert.equal(provider.clientInformation().client_secret, 'test_secret');
  assert.equal(provider.tokens().refresh_token, 'refresh-test');
});

test('OAuth redirect state and PKCE verifier persist encrypted for callback validation', async (t) => {
  const data = storage(); t.after(data.close);
  const provider = new TetherOAuthProvider({ repository: data.repository });
  const state = await provider.state();
  assert.equal(state, provider.getExpectedState());
  provider.saveCodeVerifier('private-verifier');
  provider.redirectToAuthorization('https://login.example/authorize?state=secret');
  assert.equal(provider.codeVerifier(), 'private-verifier');
  assert.equal(provider.getAuthorizationUrl(), 'https://login.example/authorize?state=secret');
  provider.clearPendingAuthorization();
  assert.equal(provider.getAuthorizationUrl(), undefined);
});
