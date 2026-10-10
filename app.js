'use strict';
/*
 * cPanel "Setup Node.js App" startup file (Application startup file: app.js).
 * Loads the compiled TypeScript application from dist/. If the build output is missing, or startup fails
 * (for example the database cannot be attached), a generic Persian message is served instead of a stack trace.
 */
function fallback(err) {
  console.error(JSON.stringify({ level: 'fatal', message: String(err && err.message).slice(0, 300) }));
  const http = require('http');
  const port = Number(process.env.PORT) || 3000;
  http
    .createServer((req, res) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('راه‌اندازی برنامه ناموفق بود. فایل dist را بررسی کنید (دستور npm run build) و لاگ برنامه را ببینید.');
    })
    .listen(port, '0.0.0.0');
}
try {
  require('./dist/server.js').start(__dirname).catch(fallback);
} catch (err) {
  fallback(err);
}
