import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, safeEqual, generateTemporaryPassword, sha256Hex } from '../../lib/crypto';
import { csvCell, csvLine } from '../../lib/csv';
import { sanitizeForLog } from '../../lib/sanitize';
import { esc, html } from '../../http/html';
import { parseCookies } from '../../http/middleware';
import { missingGrantablePermissions, SYSTEM_ROLES, ALL_PERMISSION_CODES, hasAllPermissions } from '../../rbac/permissions';

test('password hashing uses scrypt with salt and verifies correctly', async () => {
  const h = await hashPassword('Correct-Horse-1');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(h, await hashPassword('Correct-Horse-1'));
  assert.equal(await verifyPassword('Correct-Horse-1', h), true);
  assert.equal(await verifyPassword('wrong-password', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('temporary passwords are random, long enough and unambiguous', () => {
  const a = generateTemporaryPassword(14);
  const b = generateTemporaryPassword(14);
  assert.equal(a.length, 14);
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /[0O1lI]/);
});

test('constant-time equality and hashing helpers', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(sha256Hex('x').length, 64);
});

test('CSV cells are protected against formula injection', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1+1'), `"'+1+1"`);
  assert.equal(csvCell('-2'), `"'-2"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('علی'), 'علی');
  assert.equal(csvLine(['a,b', 'c"d', null, 12]), '"a,b","c""d",,12');
});

test('log sanitiser redacts secrets at any depth', () => {
  const out = sanitizeForLog({
    username: 'ali',
    password: 'p@ss',
    nested: { api_key: 'k', deep: { sessionToken: 't', ok: 1 } },
    list: [{ passwordHash: 'h' }],
  }) as Record<string, unknown>;
  assert.equal(out.username, 'ali');
  assert.equal(out.password, '[REDACTED]');
  assert.deepEqual(out.nested, { api_key: '[REDACTED]', deep: { sessionToken: '[REDACTED]', ok: 1 } });
  assert.deepEqual(out.list, [{ passwordHash: '[REDACTED]' }]);
});

test('HTML escaping neutralises injected markup in templates', () => {
  const evil = '<script>alert("x")</script>';
  assert.equal(esc(evil), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  const out = html`<p>${evil}</p>`.html;
  assert.equal(out, '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
});

test('cookie parser handles malformed values safely', () => {
  assert.deepEqual(parseCookies('a=1; b=two%20words; bad=%E0%A4%A'), { a: '1', b: 'two words', bad: '' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('anti-escalation: missing permissions are reported', () => {
  const actor = new Set(['users.view', 'users.create']);
  assert.deepEqual(missingGrantablePermissions(actor, ['users.view', 'roles.manage']), ['roles.manage']);
  assert.equal(hasAllPermissions(actor, ['users.view']), true);
  assert.equal(hasAllPermissions(actor, ['users.view', 'settings.update']), false);
});

test('system roles only reference known permissions and super admin holds all', () => {
  for (const role of SYSTEM_ROLES) {
    for (const p of role.permissions) assert.ok(ALL_PERMISSION_CODES.includes(p), `${role.slug}: ${p}`);
  }
  const superRole = SYSTEM_ROLES.find((r) => r.slug === 'super_admin')!;
  assert.equal(superRole.permissions.length, ALL_PERMISSION_CODES.length);
  const institute = SYSTEM_ROLES.find((r) => r.slug === 'institute_admin')!;
  assert.equal(institute.permissions.includes('roles.manage'), false, 'institute admin must not manage roles');
});
