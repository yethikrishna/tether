# TETHER

TETHER is an unofficial companion project for observing Fo task runs. It is not affiliated with or endorsed by Wajo. A completed status means Fo reported completion. TETHER does not independently verify outside-world results.

## Components

- `src/domain.js` contains the run state machine and status rules.
- `src/client/` contains the responsive web client, Pip mascot, in-app Island, run evidence, and settings screens.
- `src/client/state/bridge.js` contains the local API bridge, disconnected bridge, and browser-only simulator.
- `src/api.js`, `src/server.js`, and `src/fo-client.js` implement the local API and Fo adapter.
- `src/store.js` contains local encrypted run storage.
- `src/oauth-provider.js`, `src/oauth-handoff.js`, and `cloudflare/worker.js` implement OAuth registration and a one-time authorization-code handoff. The Worker does not provide a task API or live Fo access.
- `test/` and `src/client/**/__tests__/` contain backend, domain, and client tests.
- `scripts/build-demo.mjs` creates the separate static demo build.

The backend is intended to run on the owner's machine and listen on loopback. Its OAuth handoff URL is supplied through `TETHER_OAUTH_HANDOFF_URL`; the repository does not contain the owner's deployment hostname. The public Pages site is a static demo and must not use a live API origin, credentials, or backend binding.

## Requirements

- Node.js 22 or newer
- npm
- Optional: Cloudflare account and Wrangler login for Pages or Worker work

The static demo build does not require a server-side or Cloudflare runtime.

## Local development

```sh
npm ci
npm run check
npm test
src/client/scripts/check.sh
npm start
```

For the client shell, run this command at the repository root:

```sh
python3 -m http.server 8410
```

Open `http://localhost:8410/src/client/index.html` for the disconnected shell or `http://localhost:8410/src/client/index.html?demo=1` for the local simulator. The simulator stores runs in that browser's localStorage. Clear its sample data in the preview settings.

A fake-adapter backend harness is available for local testing:

```sh
node src/client/scripts/dev-fake-backend.mjs
node src/client/scripts/dev-proxy.mjs
```

The harness does not contact Fo.

## Local Fo authorization setup

Set `TETHER_OAUTH_HANDOFF_URL` to the HTTPS workers.dev origin deployed for the local TETHER installation before running `node scripts/connect-fo.js start` or `finish`. Example placeholder: `https://your-worker.your-account.workers.dev`. The callback defaults to `<handoff-url>/oauth/callback`; set `TETHER_OAUTH_REDIRECT_URL` only when the provider requires another callback URL. The local app can run without this setting, but Fo authorization cannot.

## Static demo build

```sh
npm run build:demo
```

This creates `dist-demo/` as a static site. The app is at `/src/client/`. The build removes the HTTP bridge from the published JavaScript and always uses `DemoBridge`. URL parameters cannot switch it to a backend. Simulated Fo replies carry a `[simulated Fo]` prefix and the interface uses preview labels.

The public build uses simulated fixture runs only; it does not include a recorded live run. Do not add credentials, API origins, or live OAuth configuration.

To deploy, upload `dist-demo/` to an owner-approved Cloudflare Pages project. No Worker or backend binding is needed. Check the deployed site on phone, tablet, and desktop sizes. A deploy command in project documentation is not approval to publish.

## Checks

The combined Node test suite currently contains 70 passing tests. The client check script runs 17 domain tests and 18 client/component tests, parses client JavaScript and checks referenced assets.

```sh
npm run check
npm test
src/client/scripts/check.sh
npm run build:demo
```

## Limits and security

- The Island is a web component inside the app, not a native operating-system Live Activity.
- Browser simulations run locally in the browser and do not communicate with Fo. Sample tasks are illustrative.
- Fo-reported output is not independently verified. The project has no outside-world verification integration.
- Local storage is private to this setup. The OAuth handoff Worker stores one-time authorization codes briefly and is not a public Fo API proxy.
- OAuth consent, live backend configuration, and a green interface status do not authorize a particular Fo action. Outbound actions require separate user approval.

## Author

TETHER is by Yethikrishna R. Profile: https://github.com/yethikrishna

## License

TETHER-authored project code is licensed under the MIT License. Copyright (c) 2026 Yethikrishna R. Some components remain under their original licenses; see `THIRD-PARTY-NOTICES` for Apache-2.0, MQTT, bundled dependency, and font notices.

## Device-ready code

`device/tether_status_bridge.py` is optional device-ready code for sending
short run-status notices from a Linux host. It requires the TETHER backend and
a configured local notification CLI on that host. It has passed host-side
checks, but has not been tested on physical hardware; no device compatibility
is claimed. See `device/README.md` and `THIRD-PARTY-NOTICES`.
