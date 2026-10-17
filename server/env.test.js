import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, loadRepoEnv } from './env.js';

const tmp = text => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gr8r-env-')), '.env');
  fs.writeFileSync(file, text);
  return file;
};

test('loads KEY=VALUE lines, skipping comments and blanks, with quotes and export stripped', () => {
  const file = tmp(
    [
      '# a comment',
      '',
      'ENVT_PLAIN=abc-DEF_123',
      'ENVT_QUOTED="has spaces"',
      "ENVT_SINGLE='x=y'",
      'export ENVT_EXPORTED=1',
      'ENVT_EQ=a=b=c',
      '  ENVT_PAD = padded  ',
      'not a pair',
    ].join('\n'),
  );
  loadEnv(file);
  assert.deepEqual(
    ['ENVT_PLAIN', 'ENVT_QUOTED', 'ENVT_SINGLE', 'ENVT_EXPORTED', 'ENVT_EQ', 'ENVT_PAD'].map(k => process.env[k]),
    ['abc-DEF_123', 'has spaces', 'x=y', '1', 'a=b=c', 'padded'],
  );
});

test('variables already in the environment win over the file', () => {
  process.env.ENVT_SET = 'from-shell';
  loadEnv(tmp('ENVT_SET=from-file\nENVT_NEW=from-file'));
  assert.equal(process.env.ENVT_SET, 'from-shell');
  assert.equal(process.env.ENVT_NEW, 'from-file');
});

test('a missing file is fine, any other read error is not', () => {
  assert.doesNotThrow(() => loadEnv(path.join(os.tmpdir(), 'gr8r-no-such-dir', '.env')));
  assert.throws(() => loadEnv(path.dirname(tmp(''))), /EISDIR/);
});

test('CRLF line endings and a trailing newline are handled', () => {
  loadEnv(tmp('ENVT_CRLF=yes\r\nENVT_LAST=1\r\n'));
  assert.deepEqual([process.env.ENVT_CRLF, process.env.ENVT_LAST], ['yes', '1']);
});

test('loadRepoEnv honours GR8R_ENV_FILE, and an empty value loads nothing', () => {
  const file = tmp('ENVT_REPO=from-file');
  process.env.GR8R_ENV_FILE = file;
  loadRepoEnv();
  assert.equal(process.env.ENVT_REPO, 'from-file');
  process.env.GR8R_ENV_FILE = '';
  assert.doesNotThrow(() => loadRepoEnv());
  delete process.env.GR8R_ENV_FILE;
});
