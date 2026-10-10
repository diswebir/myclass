import { createApp } from './app';
import { config } from './core/config';
import { logger } from './core/logger';

const { app } = createApp();

const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(`Server listening on http://${config.HOST}:${config.PORT} (Environment: ${config.NODE_ENV})`);
});

export default server;
