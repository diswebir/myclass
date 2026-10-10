"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.start = start;
const node_path_1 = __importDefault(require("node:path"));
const bootstrap_1 = require("./bootstrap");
const app_1 = require("./app");
const version_1 = require("./version");
/**
 * Entry point. Works both locally (`npm start`) and under cPanel "Setup Node.js App" (Phusion Passenger),
 * which sets PORT and runs the startup file `app.js` at the application root.
 */
async function start(appRoot = node_path_1.default.resolve(__dirname, '..')) {
    const runtime = (0, bootstrap_1.bootstrap)(appRoot);
    await runtime.ready;
    const app = (0, app_1.createApp)(runtime.services, runtime.publicDir);
    const host = process.env.HOST || '0.0.0.0';
    const server = app.listen(runtime.cfg.port, host, () => {
        console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'listening', version: version_1.APP_VERSION, port: runtime.cfg.port }));
    });
    const shutdown = () => {
        server.close(() => {
            void runtime.services.db.close().finally(() => process.exit(0));
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
if (require.main === module) {
    start().catch((err) => {
        const message = err instanceof Error ? err.message : 'unknown';
        console.error(JSON.stringify({ level: 'fatal', message: message.slice(0, 300) }));
        process.exit(1);
    });
}
