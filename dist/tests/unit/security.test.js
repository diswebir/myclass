"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const crypto_1 = require("../../lib/crypto");
const csv_1 = require("../../lib/csv");
const sanitize_1 = require("../../lib/sanitize");
const html_1 = require("../../http/html");
const middleware_1 = require("../../http/middleware");
const permissions_1 = require("../../rbac/permissions");
(0, node_test_1.default)('password hashing uses scrypt with salt and verifies correctly', async () => {
    const h = await (0, crypto_1.hashPassword)('Correct-Horse-1');
    strict_1.default.match(h, /^scrypt\$16384\$8\$1\$/);
    strict_1.default.notEqual(h, await (0, crypto_1.hashPassword)('Correct-Horse-1'));
    strict_1.default.equal(await (0, crypto_1.verifyPassword)('Correct-Horse-1', h), true);
    strict_1.default.equal(await (0, crypto_1.verifyPassword)('wrong-password', h), false);
    strict_1.default.equal(await (0, crypto_1.verifyPassword)('x', 'garbage'), false);
});
(0, node_test_1.default)('temporary passwords are random, long enough and unambiguous', () => {
    const a = (0, crypto_1.generateTemporaryPassword)(14);
    const b = (0, crypto_1.generateTemporaryPassword)(14);
    strict_1.default.equal(a.length, 14);
    strict_1.default.notEqual(a, b);
    strict_1.default.doesNotMatch(a, /[0O1lI]/);
});
(0, node_test_1.default)('constant-time equality and hashing helpers', () => {
    strict_1.default.equal((0, crypto_1.safeEqual)('abc', 'abc'), true);
    strict_1.default.equal((0, crypto_1.safeEqual)('abc', 'abd'), false);
    strict_1.default.equal((0, crypto_1.safeEqual)('abc', 'abcd'), false);
    strict_1.default.equal((0, crypto_1.sha256Hex)('x').length, 64);
});
(0, node_test_1.default)('CSV cells are protected against formula injection', () => {
    strict_1.default.equal((0, csv_1.csvCell)('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    strict_1.default.equal((0, csv_1.csvCell)('+1+1'), `"'+1+1"`);
    strict_1.default.equal((0, csv_1.csvCell)('-2'), `"'-2"`);
    strict_1.default.equal((0, csv_1.csvCell)('@SUM(A1)'), `"'@SUM(A1)"`);
    strict_1.default.equal((0, csv_1.csvCell)('علی'), 'علی');
    strict_1.default.equal((0, csv_1.csvLine)(['a,b', 'c"d', null, 12]), '"a,b","c""d",,12');
});
(0, node_test_1.default)('log sanitiser redacts secrets at any depth', () => {
    const out = (0, sanitize_1.sanitizeForLog)({
        username: 'ali',
        password: 'p@ss',
        nested: { api_key: 'k', deep: { sessionToken: 't', ok: 1 } },
        list: [{ passwordHash: 'h' }],
    });
    strict_1.default.equal(out.username, 'ali');
    strict_1.default.equal(out.password, '[REDACTED]');
    strict_1.default.deepEqual(out.nested, { api_key: '[REDACTED]', deep: { sessionToken: '[REDACTED]', ok: 1 } });
    strict_1.default.deepEqual(out.list, [{ passwordHash: '[REDACTED]' }]);
});
(0, node_test_1.default)('HTML escaping neutralises injected markup in templates', () => {
    const evil = '<script>alert("x")</script>';
    strict_1.default.equal((0, html_1.esc)(evil), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    const out = (0, html_1.html) `<p>${evil}</p>`.html;
    strict_1.default.equal(out, '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
});
(0, node_test_1.default)('cookie parser handles malformed values safely', () => {
    strict_1.default.deepEqual((0, middleware_1.parseCookies)('a=1; b=two%20words; bad=%E0%A4%A'), { a: '1', b: 'two words', bad: '' });
    strict_1.default.deepEqual((0, middleware_1.parseCookies)(undefined), {});
});
(0, node_test_1.default)('anti-escalation: missing permissions are reported', () => {
    const actor = new Set(['users.view', 'users.create']);
    strict_1.default.deepEqual((0, permissions_1.missingGrantablePermissions)(actor, ['users.view', 'roles.manage']), ['roles.manage']);
    strict_1.default.equal((0, permissions_1.hasAllPermissions)(actor, ['users.view']), true);
    strict_1.default.equal((0, permissions_1.hasAllPermissions)(actor, ['users.view', 'settings.update']), false);
});
(0, node_test_1.default)('system roles only reference known permissions and super admin holds all', () => {
    for (const role of permissions_1.SYSTEM_ROLES) {
        for (const p of role.permissions)
            strict_1.default.ok(permissions_1.ALL_PERMISSION_CODES.includes(p), `${role.slug}: ${p}`);
    }
    const superRole = permissions_1.SYSTEM_ROLES.find((r) => r.slug === 'super_admin');
    strict_1.default.equal(superRole.permissions.length, permissions_1.ALL_PERMISSION_CODES.length);
    const institute = permissions_1.SYSTEM_ROLES.find((r) => r.slug === 'institute_admin');
    strict_1.default.equal(institute.permissions.includes('roles.manage'), false, 'institute admin must not manage roles');
});
