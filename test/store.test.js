import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, dispatchRun } from '../src/domain.js';
import { SqliteRunRepository, VersionConflictError } from '../src/store.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tether-store-'));
  const repo = new SqliteRunRepository({ filename: join(root, 'private', 'runs.sqlite'), keyFilename: join(root, 'keys', 'local.key') });
  return { root, repo };
}

test('encrypted store survives a close/reopen and keeps sensitive prompt out of database bytes', () => {
  const { root, repo } = setup();
  const task = 'private owner-only test prompt 123';
  const run = createRun({ id: 'r1', task, now: '2026-10-18T00:00:00Z' });
  repo.save(run);
  repo.close();
  const raw = readFileSync(join(root, 'private', 'runs.sqlite')).toString('utf8');
  assert.doesNotMatch(raw, /private owner-only test prompt 123/);
  const reopened = new SqliteRunRepository({ filename: join(root, 'private', 'runs.sqlite'), keyFilename: join(root, 'keys', 'local.key') });
  assert.equal(reopened.get('r1').task, task);
  assert.equal(statSync(join(root, 'private')).mode & 0o777, 0o700);
  assert.equal(statSync(join(root, 'private', 'runs.sqlite')).mode & 0o777, 0o600);
  assert.equal(statSync(join(root, 'keys', 'local.key')).mode & 0o777, 0o600);
  reopened.close();
  rmSync(root, { recursive: true, force: true });
});

test('optimistic version check rejects a stale write', () => {
  const { root, repo } = setup();
  const run = createRun({ id: 'r1', task: 'hello' });
  repo.save(run);
  const dispatched = dispatchRun(run, { idempotencyKey: 'once' });
  repo.save(dispatched);
  assert.throws(() => repo.save(dispatched), VersionConflictError);
  repo.close();
  rmSync(root, { recursive: true, force: true });
});

test('delete removes the run and reopening does not restore it', () => {
  const { root, repo } = setup();
  repo.save(createRun({ id: 'r1', task: 'hello' }));
  assert.equal(repo.delete('r1'), true);
  assert.equal(repo.get('r1'), null);
  repo.close();
  rmSync(root, { recursive: true, force: true });
});
