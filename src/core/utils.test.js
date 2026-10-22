import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelectorAll: () => [] };
const utils = await import('./utils.js');

test('date helpers follow midnight, month and year changes through the live TODAY export', () => {
  const original = utils.TODAY;
  try {
    utils.refreshToday(new Date(2026, 11, 31, 23, 59));
    assert.equal(utils.dOff(1), '2027-01-01');
    assert.equal(utils.relDate('2027-01-01'), 'Tomorrow');
    assert.equal(utils.refreshToday(new Date(2027, 0, 1, 0, 1)), true);
    assert.equal(utils.iso(utils.TODAY), '2027-01-01');
    assert.equal(utils.relDate('2027-01-01'), 'Today');
    assert.equal(utils.relDate('2026-12-31'), 'Yesterday');
    assert.equal(utils.dOff(0), '2027-01-01');
    assert.equal(utils.refreshToday(new Date(2027, 0, 1, 15)), false);
  } finally {
    utils.refreshToday(original);
  }
});

test('refreshing after a suspended tab skips directly to the current local day', () => {
  const original = utils.TODAY;
  try {
    utils.refreshToday(new Date(2026, 9, 20));
    assert.equal(utils.refreshToday(new Date(2026, 9, 24, 12)), true);
    assert.equal(utils.diffD(utils.parse('2026-10-23'), utils.TODAY), -1);
    assert.equal(utils.dOff(3), '2026-10-27');
  } finally {
    utils.refreshToday(original);
  }
});
