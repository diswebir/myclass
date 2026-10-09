"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.randomToken = randomToken;
exports.sha256Hex = sha256Hex;
exports.safeEqual = safeEqual;
exports.generateTemporaryPassword = generateTemporaryPassword;
const node_crypto_1 = __importDefault(require("node:crypto"));
const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64, maxmem: 64 * 1024 * 1024 };
function scrypt(password, salt, keyLen, N, r, p) {
    return new Promise((resolve, reject) => {
        node_crypto_1.default.scrypt(password, salt, keyLen, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) => err ? reject(err) : resolve(key));
    });
}
/** Format: scrypt$N$r$p$saltB64$hashB64 — parameters are stored so they can be upgraded later. */
async function hashPassword(password) {
    const salt = node_crypto_1.default.randomBytes(16);
    const key = await scrypt(password, salt, SCRYPT.keyLen, SCRYPT.N, SCRYPT.r, SCRYPT.p);
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(password, stored) {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt')
        return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || expected.length === 0)
        return false;
    const actual = await scrypt(password, salt, expected.length, N, r, p);
    return node_crypto_1.default.timingSafeEqual(actual, expected);
}
function randomToken(bytes = 32) {
    return node_crypto_1.default.randomBytes(bytes).toString('base64url');
}
function sha256Hex(value) {
    return node_crypto_1.default.createHash('sha256').update(value, 'utf8').digest('hex');
}
/** Constant-time string comparison that is safe for different lengths. */
function safeEqual(a, b) {
    const ha = node_crypto_1.default.createHash('sha256').update(a).digest();
    const hb = node_crypto_1.default.createHash('sha256').update(b).digest();
    return node_crypto_1.default.timingSafeEqual(ha, hb) && a.length === b.length;
}
/** Generates a readable temporary password (no ambiguous characters). */
function generateTemporaryPassword(length = 14) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = node_crypto_1.default.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++)
        out += alphabet[bytes[i] % alphabet.length];
    return out;
}
