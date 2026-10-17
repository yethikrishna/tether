/* ============================================================
   Dev-only: the REAL TETHER API with a scripted fake Fo adapter.
   No Fo traffic ever leaves the machine, and no OAuth grant is
   needed. Every fake Fo reply carries a '[simulated Fo]' marker
   so a screenshot of this harness can never pass for live Fo.
   Usage: node src/client/scripts/dev-fake-backend.mjs  (from repo root)
   Env:   TETHER_BACKEND_DIR (default ../tether-backend),
          TETHER_API_PORT (default 4173), TETHER_FAKE_DATA (default /tmp/tether-fake-data)
   ============================================================ */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.env.TETHER_BACKEND_DIR ?? '../tether-backend';
const { createTetherServer, recoverInterruptedDispatches } = await import(pathToFileURL(resolve(dir, 'src/api.js')).href);
const { SqliteRunRepository } = await import(pathToFileURL(resolve(dir, 'src/store.js')).href);

const dataDir = resolve(process.env.TETHER_FAKE_DATA ?? '/tmp/tether-fake-data');
const repository = new SqliteRunRepository({
  filename: resolve(dataDir, 'runs.sqlite'),
  keyFilename: resolve(dataDir, 'local-dev.key'),
});
const recovered = recoverInterruptedDispatches(repository);
if (recovered) process.stdout.write(`recovered ${recovered} in-flight dispatch(es) as outcome-unknown (not replayed)\n`);

let n = 0;
const steps = new Map();
const fakeFo = {
  async askFo({ message, newConversation, conversationId }) {
    // a task containing [slow] hangs the dispatch so reload-during-dispatch
    // recovery can be exercised; it resolves after 6s if the server lives
    if (newConversation && String(message).includes('[slow]')) await new Promise((r) => setTimeout(r, 6000));
    if (newConversation) {
      const cid = `fake-cid-${Date.now().toString(36)}-${++n}`;
      steps.set(cid, 0);
      return { status: 'working', response: '[simulated Fo] On it — working through this now.', conversationId: cid };
    }
    return { status: 'working', response: '[simulated Fo] Got your answer — continuing with that.', conversationId };
  },
  async getFoReply({ conversationId }) {
    const s = (steps.get(conversationId) ?? 0) + 1;
    steps.set(conversationId, s);
    if (s === 1) return { status: 'working', response: '[simulated Fo] I need your answer: should I use the short version or the detailed version?', conversationId };
    return { status: 'complete', response: '[simulated Fo] Done — the task is finished.', conversationId };
  },
};

const server = createTetherServer({ repository, foClient: fakeFo });
const port = Number(process.env.TETHER_API_PORT ?? 4173);
server.listen(port, '127.0.0.1', () => process.stdout.write(`tether API (fake Fo adapter) on http://127.0.0.1:${port}\n`));
