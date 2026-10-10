"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const error_handler_1 = require("../../http/error-handler");
const errors_1 = require("../../lib/errors");
(0, node_test_1.default)('database connectivity and credential errors are classified as unavailable', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR']) {
        strict_1.default.equal((0, error_handler_1.isDbUnavailable)({ code, message: 'x' }), true, code);
    }
});
(0, node_test_1.default)('application and unrelated errors are not classified as database outages', () => {
    strict_1.default.equal((0, error_handler_1.isDbUnavailable)(new Error('boom')), false);
    strict_1.default.equal((0, error_handler_1.isDbUnavailable)(null), false);
    strict_1.default.equal((0, error_handler_1.isDbUnavailable)({ code: 'ER_DUP_ENTRY' }), false);
    strict_1.default.equal((0, error_handler_1.isDbUnavailable)(errors_1.errors.badRequest('bad')), false);
});
