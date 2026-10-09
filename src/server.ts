import path from 'node:path';
import { bootstrap } from './bootstrap';
import { createApp } from './app';
import { APP_VERSION } from './version';

/**
 * Entry point. Works both locally (`npm start`) and under cPanel "Setup Node.js App" (Phusion Passenger),
 * which sets PORT and runs the startup file `app.js` at the application root.
 */
export function start(appRoot: string = path.resolve(__dirname, '..')): void {
  const runtime = bootstrap(appRoot);
  const app = createApp(runtime.services, runtime.publicDir);
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(runtime.cfg.port, host, () => {
    console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'listening', version: APP_VERSION, port: runtime.cfg.port }));
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
  try {
    start();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error(JSON.stringify({ level: 'fatal', message: message.slice(0, 300) }));
    process.exit(1);
  }
}
