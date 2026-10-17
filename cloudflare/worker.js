const MAX_CODE_LENGTH = 8192;
const MAX_SECRET_LENGTH = 256;
const HANDOFF_TTL_MS = 120_000;
const BASE_HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8' } });
}
function html(status, body) {
  return new Response(body, { status, headers: { ...BASE_HEADERS, 'content-type': 'text/html; charset=utf-8' } });
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function parseSmallJson(request) {
  const length = Number(request.headers.get('content-length') || '0');
  if (length > 4096) return null;
  try {
    const text = await request.text();
    if (text.length > 4096) return null;
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}
async function objectForState(env, state) {
  const id = env.HANDOFF.idFromName(await digest(state));
  return env.HANDOFF.get(id);
}

export class HandoffSession {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/arm' && request.method === 'POST') {
      const body = await parseSmallJson(request);
      if (!body || typeof body.state !== 'string' || body.state.length < 32 || body.state.length > 256 || typeof body.handoffSecret !== 'string' || body.handoffSecret.length < 32 || body.handoffSecret.length > MAX_SECRET_LENGTH) return json(400, { error: 'Invalid setup.' });
      if (typeof body.handoffSecret !== 'string' || !/^[A-Za-z0-9_-]+$/.test(body.handoffSecret)) return json(400, { error: 'Invalid setup.' });
      const now = Date.now();
      const record = { stateHash: await digest(body.state), secretHash: await digest(body.handoffSecret), expiresAt: now + HANDOFF_TTL_MS, code: null, error: null, consumed: false };
      let armed = false;
      await this.state.storage.transaction(async (txn) => {
        const existing = await txn.get('handoff');
        if (existing && existing.expiresAt > now) return;
        await txn.put('handoff', record);
        armed = true;
      });
      if (!armed) return json(409, { error: 'A handoff is already active.' });
      await this.state.storage.setAlarm(record.expiresAt);
      return json(201, { armed: true, expiresAt: record.expiresAt });
    }
    if (path === '/callback' && request.method === 'POST') {
      const body = await parseSmallJson(request);
      if (!body || typeof body.state !== 'string' || ((!body.code || typeof body.code !== 'string') && !body.error) || (body.code && (typeof body.code !== 'string' || body.code.length > MAX_CODE_LENGTH))) return json(400, { error: 'Invalid callback.' });
      const stateHash = await digest(body.state);
      const now = Date.now();
      let accepted = false;
      await this.state.storage.transaction(async (txn) => {
        const record = await txn.get('handoff');
        if (!record || record.expiresAt <= now || record.consumed || record.code || record.error || !safeEqual(record.stateHash, stateHash)) return;
        record.code = typeof body.code === 'string' ? body.code : null;
        record.error = typeof body.error === 'string' ? body.error.slice(0, 128) : null;
        // Never persist OAuth error descriptions, request headers, or raw callback URLs.
        await txn.put('handoff', record);
        accepted = true;
      });
      return accepted ? json(202, { received: true }) : json(410, { error: 'Handoff unavailable.' });
    }
    if (path === '/take' && request.method === 'POST') {
      const body = await parseSmallJson(request);
      if (!body || typeof body.handoffSecret !== 'string') return json(400, { error: 'Invalid retrieval.' });
      const suppliedHash = await digest(body.handoffSecret);
      let result = null;
      await this.state.storage.transaction(async (txn) => {
        const record = await txn.get('handoff');
        if (!record || record.expiresAt <= Date.now() || record.consumed || !safeEqual(record.secretHash, suppliedHash)) return;
        if (record.error) {
          record.consumed = true;
          record.code = null;
          await txn.put('handoff', record);
          result = { error: record.error };
          return;
        }
        if (!record.code) return;
        result = { code: record.code };
        record.consumed = true;
        record.code = null;
        record.secretHash = '';
        await txn.put('handoff', record);
      });
      return result ? json(200, result) : json(404, { pending: true });
    }
    return json(404, { error: 'Not found.' });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (!state || state.length < 32 || state.length > 256 || (!code && !error) || (code && code.length > MAX_CODE_LENGTH)) {
        return html(400, '<!doctype html><meta charset="utf-8"><title>Sign-in could not finish</title><p>Sign-in could not finish. Close this tab and return to TETHER.</p>');
      }
      try {
        const stub = await objectForState(env, state);
        const response = await stub.fetch('https://handoff/callback', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state, ...(code ? { code } : {}), ...(error ? { error } : {}) }),
        });
        if (!response.ok) return html(410, '<!doctype html><meta charset="utf-8"><title>Sign-in expired</title><p>Sign-in expired. Return to TETHER and start again.</p>');
        return Response.redirect(new URL('/complete', url), 303);
      } catch {
        return html(503, '<!doctype html><meta charset="utf-8"><title>Sign-in unavailable</title><p>Return to TETHER. The sign-in handoff is unavailable.</p>');
      }
    }
    if (url.pathname === '/complete' && request.method === 'GET') {
      return html(200, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Return to TETHER</title><main><h1>Return to TETHER</h1><p>Your sign-in response was received. You can close this tab.</p></main>');
    }
    if (url.pathname.startsWith('/internal/')) {
      // No permissive CORS; the local server calls this over HTTPS, never browser JavaScript.
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
      const body = await parseSmallJson(request);
      if (!body || typeof body.state !== 'string' || body.state.length < 32 || body.state.length > 256) return json(400, { error: 'Invalid request.' });
      const stub = await objectForState(env, body.state);
      if (url.pathname === '/internal/arm') return stub.fetch('https://handoff/arm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (url.pathname === '/internal/take') return stub.fetch('https://handoff/take', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
    return json(404, { error: 'Not found.' });
  },
};
