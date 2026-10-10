"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./core/config");
const logger_1 = require("./core/logger");
const { app } = (0, app_1.createApp)();
const server = app.listen(config_1.config.PORT, config_1.config.HOST, () => {
    logger_1.logger.info(`Server listening on http://${config_1.config.HOST}:${config_1.config.PORT} (Environment: ${config_1.config.NODE_ENV})`);
});
exports.default = server;
