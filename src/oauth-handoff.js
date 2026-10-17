import { randomBytes } from 'node:crypto';

export class CloudflareOAuthHandoff {
  constructor({ baseUrl, fetchImpl = fetch, repository, pollIntervalMs = 1000 } = {}) {
    if (!repository) throw new TypeError('repository is required');
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:' || !base.hostname.endsWith('.workers.dev')) throw new Error('handoff must use a verified HTTPS workers.dev origin');
    this.baseUrl = base.origin;
    this.fetchImpl = fetchImpl;
    this.repository = repository;
    this.pollIntervalMs = pollIntervalMs;
  }
  async arm(state) {
    const secret = randomBytes(32).toString('base64url');
    const response = await this.fetchImpl(`${this.baseUrl}/internal/arm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, handoffSecret: secret }),
    });
    if (!response.ok) throw new Error(`OAuth handoff could not be armed (${response.status}).`);
    const runId = `fo.oauth.handoff.${state}`;
    this.repository.setSecret(runId, secret);
    return { state, secret, expiresAt: Date.now() + 120_000 };
  }
  async take({ state, secret, timeoutMs = 120_000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const response = await this.fetchImpl(`${this.baseUrl}/internal/take`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, handoffSecret: secret }),
      });
      if (response.ok) {
        const result = await response.json();
        this.repository.deleteSecret(`fo.oauth.handoff.${state}`);
        if (typeof result.code === 'string' && result.code.length) return result.code;
        if (typeof result.error === 'string') throw new Error('OAuth authorization was denied or failed.');
      } else if (response.status !== 404) {
        throw new Error(`OAuth handoff retrieval failed (${response.status}).`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    this.repository.deleteSecret(`fo.oauth.handoff.${state}`);
    throw new Error('OAuth handoff expired before the local app received it.');
  }
}
