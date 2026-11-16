'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleMessage } = require('../../src/protocol');
test('mode changes and readiness return authoritative mode', () => {
  assert.deepEqual(handleMessage('preview', { type: 'setMode', mode: 'edit' }), { mode: 'edit' });
  assert.deepEqual(handleMessage('edit', { type: 'ready' }), { mode: 'edit' });
});
test('invalid messages and editing commands cannot change mode', () => {
  for (const message of [null, [], { type: 'setMode', mode: 'other' }, { type: 'split' }]) {
    const result = handleMessage('preview', message);
    assert.equal(result.mode, 'preview');
    assert.ok(result.error);
  }
});
