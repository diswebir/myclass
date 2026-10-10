"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Database = exports.DbNotConfiguredError = void 0;
const node_async_hooks_1 = require("node:async_hooks");
/** Raised when a query runs before an engine has been chosen and connected (fresh install). */
class DbNotConfiguredError extends Error {
    code = 'DB_NOT_CONFIGURED';
    constructor() {
        super('پایگاه داده هنوز انتخاب یا متصل نشده است.');
        this.name = 'DbNotConfiguredError';
    }
}
exports.DbNotConfiguredError = DbNotConfiguredError;
/**
 * Engine-independent facade used by every service. It forwards to the attached driver and keeps
 * nested calls inside a transaction or withConnection on the SAME connection. This matters for SQLite:
 * its single queued connection would otherwise wait on itself. All application SQL MUST use `?` placeholders.
 */
class Database {
    driver = null;
    scope = new node_async_hooks_1.AsyncLocalStorage();
    /** Attaches a connected driver. The previous driver, if any, is closed first. */
    async attach(driver) {
        const previous = this.driver;
        this.driver = driver;
        if (previous && previous !== driver)
            await previous.close().catch(() => undefined);
    }
    get isConnected() {
        return this.driver !== null;
    }
    get driverName() {
        return this.driver?.name ?? null;
    }
    get dialect() {
        return this.requireDriver().dialect;
    }
    requireDriver() {
        if (!this.driver)
            throw new DbNotConfiguredError();
        return this.driver;
    }
    async query(sql, params = []) {
        const scoped = this.scope.getStore();
        if (scoped)
            return scoped.query(sql, params);
        return this.requireDriver().query(sql, params);
    }
    async execute(sql, params = []) {
        const scoped = this.scope.getStore();
        if (scoped)
            return scoped.execute(sql, params);
        return this.requireDriver().execute(sql, params);
    }
    /** Runs `fn` on ONE connection. Session-scoped state such as a named lock stays on that connection. */
    async withConnection(fn) {
        const scoped = this.scope.getStore();
        if (scoped)
            return fn(scoped);
        return this.requireDriver().withConnection(async (q) => this.scope.run(q, () => fn(q)));
    }
    /** Runs `fn` inside a transaction; rolls back on any thrown error. Nested calls join the outer transaction. */
    async transaction(fn) {
        const scoped = this.scope.getStore();
        if (scoped)
            return fn(scoped);
        return this.requireDriver().transaction(async (tx) => this.scope.run(tx, () => fn(tx)));
    }
    async ping() {
        await this.requireDriver().ping();
    }
    async close() {
        const driver = this.driver;
        this.driver = null;
        if (driver)
            await driver.close();
    }
}
exports.Database = Database;
