import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECUR_DAYS, nextDue } from './recur.js';

test('the repeat options, in the order the app offers them', () => {
  assert.deepEqual(Object.keys(RECUR_DAYS), ['Daily', 'Weekly', 'Every 2 weeks', 'Monthly']);
});

test('nextDue moves a due date forward by the repeat length', () => {
  assert.equal(nextDue('2026-10-18', 'Daily'), '2026-10-19');
  assert.equal(nextDue('2026-10-18', 'Weekly'), '2026-10-25');
  assert.equal(nextDue('2026-10-18', 'Every 2 weeks'), '2026-11-01');
  assert.equal(nextDue('2026-10-18', 'Monthly'), '2026-11-17');
});

test('nextDue crosses month and year ends and leap days', () => {
  assert.equal(nextDue('2026-12-31', 'Daily'), '2027-01-01');
  assert.equal(nextDue('2028-02-28', 'Daily'), '2028-02-29');
  assert.equal(nextDue('2026-03-29', 'Weekly'), '2026-04-05');
});

test('an unknown repeat falls back to weekly, as both writers always did', () => {
  assert.equal(nextDue('2026-10-18', 'Fortnightly-ish'), '2026-10-25');
});
