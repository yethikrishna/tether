import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const root = process.cwd();
const out = resolve(root, 'dist-demo');
const clientSource = resolve(root, 'src/client');
const clientOut = resolve(out, 'src/client');
await rm(out, { recursive: true, force: true });
await mkdir(clientOut, { recursive: true });
await cp(clientSource, clientOut, {
  recursive: true,
  filter: (source) => !source.includes('/scripts/') && !source.includes('/__tests__/') && !source.endsWith('/README.md') && !source.endsWith('/state/bridge.js'),
});
await cp(resolve(root, 'src/domain.js'), resolve(out, 'src/domain.js'));
await cp(resolve(root, 'THIRD-PARTY-NOTICES'), resolve(out, 'THIRD-PARTY-NOTICES'));
await cp(resolve(root, 'LICENSE'), resolve(out, 'LICENSE'));

// Generate a demo-only bridge from the DemoBridge class. The published app
// contains no HttpBridge, fetch client, or backend endpoint implementation.
const bridge = await readFile(resolve(clientSource, 'state/bridge.js'), 'utf8');
const start = bridge.indexOf('/* ---------------- DemoBridge: labeled local preview ---------------- */');
if (start < 0) throw new Error('DemoBridge section not found');
const demoModule = `import { APP_STATUS, createRun, dispatchRun, applyInitialReply, applyPollReply, beginAnswer, markDispatchUnknown, markConnectionInterrupted, stopObserving, mayPoll } from '../../domain.js';\n\nconst now = () => new Date().toISOString();\n\n${bridge.slice(start)}`;
const demoBridgePath = resolve(clientOut, 'state/demo-bridge.js');
await mkdir(dirname(demoBridgePath), { recursive: true });
await writeFile(demoBridgePath, demoModule);

// The public demo contains only simulated fixture runs. No recorded live
// conversation or run snapshot is loaded into this build.
const recordedModulePath = resolve(clientOut, 'state/recorded-run.js');
await writeFile(recordedModulePath, 'export const recordedRun = null;\n');

// The deployed build always selects DemoBridge, regardless of query string or
// localStorage. This edit is generated from one known source anchor and fails
// closed if the app changes shape.
const appPath = resolve(clientOut, 'app.js');
let app = await readFile(appPath, 'utf8');
app = app.replace("import { HttpBridge, NullBridge, DemoBridge } from './state/bridge.js';", "import { DemoBridge } from './state/demo-bridge.js';");
const oldFactory = `async function makeBridge() {\n  const wantDemo = new URLSearchParams(location.search).has('demo') || LS.getItem('tether:mode') === 'demo';\n  if (wantDemo) {\n    const b = new DemoBridge();\n    b.seed();\n    return b;\n  }\n  const http = new HttpBridge();\n  const c = await http.connect();\n  if (c.connected) return http;\n  return new NullBridge();\n}`;
const demoFactory = `async function makeBridge() {\n  const b = new DemoBridge();\n  b.seed();\n  return b;\n}`;
if (!app.includes(oldFactory)) throw new Error('Bridge factory changed; refusing non-forced demo build');
app = app.replace(oldFactory, demoFactory);
await writeFile(appPath, app);

// The live build has no API route behavior. Keep only ordinary static
// network fallback in the service worker.
const swPath = resolve(clientOut, 'sw.js');
let sw = await readFile(swPath, 'utf8');
sw = sw.replace("  if (url.pathname.includes('/api/')) return; // never cache API\n", '');
if (sw.includes('/api/')) throw new Error('API routing found in demo service worker');
await writeFile(swPath, sw);

// Pages root lands on the app. The app remains under /src/client so its
// relative imports preserve the combined repo module layout.
await writeFile(resolve(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=/src/client/"><title>TETHER demo</title><link rel="canonical" href="/src/client/"></head><body><p>Opening the TETHER simulated preview. <a href="/src/client/">Continue</a></p></body></html>\n`);
// Assert the output is demo-only and every scripted Fo report carries its marker.
const { readdir } = await import('node:fs/promises');
async function allFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? allFiles(resolve(dir, entry.name)) : [resolve(dir, entry.name)]))).flat();
}
const files = await allFiles(out);
const textFiles = files.filter((file) => !/\.(png|woff2)$/i.test(file));
const combined = (await Promise.all(textFiles.map((file) => readFile(file, 'utf8')))).join('\n');
for (const forbidden of ['HttpBridge', 'oauth-provider', 'client_secret', 'TETHER_DATA_DIR']) {
  if (combined.includes(forbidden)) throw new Error(`Forbidden live capability found in demo output: ${forbidden}`);
}
// Home Assistant's vendored websocket client legitimately connects to the
// user's own /api/websocket endpoint. Reject TETHER backend routes specifically.
for (const route of ["'/api/health'", "'/api/runs'", "'/api/runs/"]) {
  if (combined.includes(route)) throw new Error(`TETHER backend route found in demo output: ${route}`);
}
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { DemoBridge: BuiltDemoBridge } = await import(new URL(`file://${resolve(clientOut, 'state/demo-bridge.js')}`).href);
const bridgeInstance = new BuiltDemoBridge();
bridgeInstance.seed();
const runs = await bridgeInstance.listRuns();
for (const run of runs) {
  if (!run.demo) throw new Error(`Unlabeled fixture run: ${run.id}`);
  for (const event of run.events.filter((item) => item.source === 'fo_response')) {
    if (!String(event.foReport?.response ?? '').startsWith('[simulated Fo]')) throw new Error(`Unprefixed simulated Fo event in ${run.id}`);
  }
  if (run.lastFoResponse && !run.lastFoResponse.startsWith('[simulated Fo]')) throw new Error(`Unprefixed simulated Fo reply in ${run.id}`);
}
bridgeInstance.destroy();
console.log(`Built and checked simulated-only Pages site at ${out} (${files.length} static files)`);
