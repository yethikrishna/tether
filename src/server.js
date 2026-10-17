import { resolve } from 'node:path';
import { SqliteRunRepository } from './store.js';
import { createTetherServer, recoverInterruptedDispatches } from './api.js';
import { FoMcpClient } from './fo-client.js';
import { CloudflareOAuthHandoff } from './oauth-handoff.js';
import { TetherOAuthProvider } from './oauth-provider.js';

const handoffUrl = process.env.TETHER_OAUTH_HANDOFF_URL;
const handoffPlaceholder = 'https://tether-oauth-handoff.example.workers.dev';
const redirectUrl = process.env.TETHER_OAUTH_REDIRECT_URL ?? `${handoffUrl ?? handoffPlaceholder}/oauth/callback`;
const repository = new SqliteRunRepository({
  filename: resolve(process.env.TETHER_DATA_DIR ?? '.data', 'runs.sqlite'),
  keyFilename: resolve(process.env.TETHER_KEY_DIR ?? '.data', 'local-dev.key'),
});
recoverInterruptedDispatches(repository);
const handoff = handoffUrl ? new CloudflareOAuthHandoff({ baseUrl: handoffUrl, repository }) : null;
const authProvider = new TetherOAuthProvider({ repository, redirectUrl, handoff });
let foClient = null;
if (authProvider.tokens()) {
  try {
    foClient = await FoMcpClient.connect({ authProvider });
  } catch {
    authProvider.clearPendingAuthorization();
    process.stderr.write('TETHER could not connect to Fo; task actions remain disabled.\n');
  }
}
const server = createTetherServer({ repository, foClient });
const port = Number(process.env.PORT ?? 4173);
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`TETHER local-only server listening at http://127.0.0.1:${port}; Fo ${foClient ? 'is connected; no task was sent' : 'is not connected'}.\n`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(async () => {
    if (foClient) await foClient.close();
    repository.close();
  });
});
