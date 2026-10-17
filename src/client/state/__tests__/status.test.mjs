import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_STATUS, getMascotState } from '../../../domain.js';
import { STATUS_META } from '../status.js';
import { aggregateMascotState, statusMood } from '../../components/pip-dock.js';

test('every app status has an honest, distinct label', () => {
  for (const s of Object.values(APP_STATUS)) {
    assert.ok(STATUS_META[s], `missing STATUS_META for ${s}`);
    assert.ok(STATUS_META[s].label.length > 3);
  }
  // terminal states are always marked Fo-reported
  assert.match(STATUS_META[APP_STATUS.COMPLETED].label, /Fo-reported/);
  assert.match(STATUS_META[APP_STATUS.FAILED].label, /Fo-reported/);
  // never collapse interrupted / failed / completed
  const labels = ['CONNECTION_INTERRUPTED', 'FAILED', 'COMPLETED'].map((k) => STATUS_META[APP_STATUS[k]].label);
  assert.equal(new Set(labels).size, 3);
});

test('aggregate mascot state derives from real runs, priority-ordered', () => {
  const run = (status) => ({ status, updatedAt: new Date().toISOString() });
  assert.equal(aggregateMascotState([]), 'sleep');
  assert.equal(aggregateMascotState([run(APP_STATUS.WAITING_FOR_USER), run(APP_STATUS.WORKING)]), 'needs_you');
  assert.equal(aggregateMascotState([run(APP_STATUS.WORKING), run(APP_STATUS.DISPATCHING)]), 'curious');
  assert.equal(aggregateMascotState([run(APP_STATUS.CONNECTION_INTERRUPTED)]), 'annoyed');
  assert.equal(aggregateMascotState([run(APP_STATUS.OUTCOME_UNKNOWN)]), 'annoyed');
  assert.equal(aggregateMascotState([run(APP_STATUS.FAILED)]), 'angry');
  assert.equal(aggregateMascotState([run(APP_STATUS.FAILED), run(APP_STATUS.CONNECTION_INTERRUPTED)]), 'angry');
  assert.equal(aggregateMascotState([run(APP_STATUS.WAITING_FOR_USER), run(APP_STATUS.FAILED)]), 'needs_you');
  assert.equal(aggregateMascotState([run(APP_STATUS.COMPLETED)]), 'success_soft');
  // per-run moods stay inside the mascot's known set
  for (const s of Object.values(APP_STATUS)) {
    assert.ok(['idle','notice','thinking','needs_you','success_soft','uncertain','sleep'].includes(getMascotState(s)));
    assert.ok(['idle','needs_you','success_soft','sleep','curious','annoyed','angry'].includes(statusMood(s)));
  }
});
