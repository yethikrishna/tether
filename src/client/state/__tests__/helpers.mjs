/* Test shims: DemoBridge persists to localStorage; give tests a fresh one. */
export function shimLocalStorage() {
  const s = new Map();
  globalThis.localStorage = {
    getItem: (k) => (s.has(k) ? s.get(k) : null),
    setItem: (k, v) => s.set(k, String(v)),
    removeItem: (k) => s.delete(k),
    clear: () => s.clear(),
  };
  return s;
}
export const FAST = { initialReply: 5, waitingPrompt: 12, answerReply: 5, answerComplete: 12, resumePrompt: 12 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
