import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

export const FO_ENDPOINT = 'https://mcp.api.wajo.ai/fo';

function unwrapToolResult(result) {
  if (!result || result.isError === true) throw new Error('Fo MCP tool returned an error.');
  if (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)) return result.structuredContent;
  for (const item of result.content ?? []) {
    if (item.type !== 'text' || typeof item.text !== 'string') continue;
    try {
      const parsed = JSON.parse(item.text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* retain no arbitrary free-form output as a trusted status object */ }
  }
  return {};
}

/**
 * Thin typed Fo MCP adapter. OAuth/client provisioning is performed separately;
 * this adapter only uses the official MCP SDK and never falls back to raw HTTP.
 */
export class FoMcpClient {
  constructor({ client = new Client({ name: 'TETHER', version: '0.1.0' }), transport } = {}) {
    if (!transport) throw new TypeError('an authenticated SDK transport is required');
    this.client = client;
    this.transport = transport;
    this.closed = false;
  }
  static async connect({ authProvider, url = FO_ENDPOINT, clientName = 'TETHER', version = '0.1.0', fetch: fetchImpl } = {}) {
    const client = new Client({ name: clientName, version });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      authProvider,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
      redirectPolicy: 'same-origin',
    });
    await client.connect(transport);
    return new FoMcpClient({ client, transport });
  }
  async askFo({ message, conversationId, newConversation }) {
    const args = { message };
    if (typeof conversationId === 'string' && conversationId) args.conversationId = conversationId;
    if (newConversation === true) args.newConversation = true;
    const result = await this.client.callTool({ name: 'ask_fo', arguments: args });
    return unwrapToolResult(result);
  }
  async getFoReply({ conversationId, waitSeconds = 0 }) {
    const args = { waitSeconds };
    if (typeof conversationId === 'string' && conversationId) args.conversationId = conversationId;
    const result = await this.client.callTool({ name: 'get_fo_reply', arguments: args });
    return unwrapToolResult(result);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.transport.close();
  }
}

/** Start registration/auth and retain the authorization URL for an explicit owner click. */
export async function prepareFoAuthorization({ provider, endpoint = FO_ENDPOINT, fetch: fetchImpl } = {}) {
  const result = await auth(provider, { serverUrl: endpoint, scope: 'mcp', ...(fetchImpl ? { fetchFn: fetchImpl } : {}) });
  if (result !== 'REDIRECT') return { status: 'authorized', authorizationUrl: null };
  return { status: 'awaiting_owner_consent', authorizationUrl: provider.getAuthorizationUrl() };
}

export { UnauthorizedError };
