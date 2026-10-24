import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MilestoneError, addMilestone, changeMilestone, removeMilestone } from './milestones.js';

const project = () => ({ key: 'GR', milestones: [{ name: 'Beta', date: '2026-11-01' }] });
const fails = (fn, status, re) => assert.throws(fn, e => e instanceof MilestoneError && e.status === status && re.test(e.message));

test('addMilestone appends a trimmed name and a date, creating the list if needed', () => {
  const p = project();
  assert.deepEqual(addMilestone(p, { name: ' Launch ', date: '2026-12-01' }), { name: 'Launch', date: '2026-12-01' });
  assert.deepEqual(
    p.milestones.map(m => m.name),
    ['Beta', 'Launch'],
  );
  const bare = { key: 'X' };
  addMilestone(bare, { name: 'One', date: '2026-12-01' });
  assert.equal(bare.milestones.length, 1);
});

test('names are required and unique per project ignoring case; dates must be real', () => {
  const p = project();
  fails(() => addMilestone(p, { name: 'beta', date: '2026-12-01' }), 400, /already has a milestone called beta/);
  fails(() => addMilestone(p, { name: '  ', date: '2026-12-01' }), 400, /name/);
  fails(() => addMilestone(p, { name: 'X', date: '2026-02-30' }), 400, /YYYY-MM-DD/);
  fails(() => addMilestone(p, { name: 'X' }), 400, /name and date are required/);
  fails(() => addMilestone(p, { name: 'X', date: '2026-12-01', extra: 1 }), 400, /unknown field: extra/);
  assert.equal(p.milestones.length, 1, 'nothing changes on a refusal');
});

test('changeMilestone finds by name ignoring case and may keep its own name', () => {
  const p = project();
  assert.deepEqual(changeMilestone(p, 'BETA', { name: 'Beta', date: '2026-11-15' }), { name: 'Beta', date: '2026-11-15' });
  fails(() => changeMilestone(p, 'Gamma', { date: '2026-11-15' }), 404, /no milestone Gamma on GR/);
  fails(() => changeMilestone(p, 'Beta', {}), 400, /no fields/);
});

test('removeMilestone deletes by name and returns it', () => {
  const p = project();
  assert.deepEqual(removeMilestone(p, 'beta'), { name: 'Beta', date: '2026-11-01' });
  assert.deepEqual(p.milestones, []);
  fails(() => removeMilestone(p, 'beta'), 404, /no milestone/);
});
