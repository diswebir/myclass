import test from 'node:test';
import assert from 'node:assert/strict';
import { isDbUnavailable } from '../../http/error-handler';
import { errors } from '../../lib/errors';

test('database connectivity and credential errors are classified as unavailable', () => {
  for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR']) {
    assert.equal(isDbUnavailable({ code, message: 'x' }), true, code);
  }
});

test('application and unrelated errors are not classified as database outages', () => {
  assert.equal(isDbUnavailable(new Error('boom')), false);
  assert.equal(isDbUnavailable(null), false);
  assert.equal(isDbUnavailable({ code: 'ER_DUP_ENTRY' }), false);
  assert.equal(isDbUnavailable(errors.badRequest('bad')), false);
});
