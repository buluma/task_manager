import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkTo, resolveLink } from './links.js';

const data = {
  tasks: [{ id: 't1', key: 'GR-12' }],
  projects: [
    { id: 'p1', key: 'GR' },
    { id: 'p2', key: 'OLD', archived: true },
  ],
};

test('linkTo builds a task or project link on the page it is given', () => {
  assert.equal(linkTo('http://gr8r.ts.net:8787/', 'task', 'GR-12'), 'http://gr8r.ts.net:8787/#task/GR-12');
  assert.equal(linkTo('http://gr8r.ts.net:8787/', 'project', 'GR'), 'http://gr8r.ts.net:8787/#project/gr');
});

test('resolveLink finds the task or project a link names, ignoring case', () => {
  assert.deepEqual(resolveLink(data, '#task/GR-12'), { task: 't1' });
  assert.deepEqual(resolveLink(data, '#task/gr-12'), { task: 't1' });
  assert.deepEqual(resolveLink(data, '#project/gr'), { project: 'p1' });
});

test('resolveLink ignores page routes, unknown keys, archived projects and malformed links', () => {
  for (const hash of ['', '#inbox', '#task/GR-99', '#project/old', '#project/', '#task/GR-12/extra', '#file/f1'])
    assert.equal(resolveLink(data, hash), null, hash);
});
