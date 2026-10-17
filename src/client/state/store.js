/* Tiny observable store. The database (backend) is the source of
   truth in production; in local-preview mode localStorage plays that
   role, so a reload recovers the exact run state. */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      subs.forEach((fn) => fn(state));
    },
    replace(next) { state = next; subs.forEach((fn) => fn(state)); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
