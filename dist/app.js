"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const middleware_1 = require("./http/middleware");
const error_handler_1 = require("./http/error-handler");
const auth_routes_1 = require("./routes/auth.routes");
const install_routes_1 = require("./routes/install.routes");
const admin_routes_1 = require("./routes/admin.routes");
/** Builds the Express application. All dependencies are injected, which keeps the app testable. */
function createApp(s, publicDir) {
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.set('trust proxy', s.cfg.trustProxy);
    app.use((0, middleware_1.securityHeaders)());
    // Only the public/assets folder is exposed; everything else in the application root stays private.
    app.use('/assets', express_1.default.static(node_path_1.default.join(publicDir, 'assets'), {
        index: false,
        dotfiles: 'deny',
        maxAge: s.cfg.isProduction ? '7d' : 0,
    }));
    app.use((0, middleware_1.clientIpMiddleware)(s.cfg.trustProxy));
    app.use(express_1.default.urlencoded({ extended: false, limit: '64kb' }));
    app.use((0, middleware_1.csrfMiddleware)(s.cfg));
    app.get('/health', async (_req, res) => {
        try {
            await s.db.ping();
            res.json({ status: 'ok' });
        }
        catch {
            res.status(503).json({ status: 'error' });
        }
    });
    app.use((0, middleware_1.installGate)(s));
    app.use((0, middleware_1.authMiddleware)(s));
    app.get('/', (_req, res) => {
        res.redirect(302, '/admin');
    });
    app.use((0, install_routes_1.installRoutes)(s));
    app.use((0, auth_routes_1.authRoutes)(s));
    app.use((0, admin_routes_1.adminRoutes)(s));
    app.use((0, error_handler_1.notFoundHandler)(s));
    app.use((0, error_handler_1.errorHandler)(s));
    return app;
}
