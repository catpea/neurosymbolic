import { join, dirname, resolve } from 'path';
import { realpathSync }           from 'fs';
import { fileURLToPath }          from 'url';

import framework from 'web-framework';
import { registerAIRoute }     from './routes/ai.js';
import { registerHealthRoute } from './routes/health.js';
import { registerXmlRoute }    from './routes/xml.js';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..', '..');

const DEFAULT_PORT = process.env.PORT ?? 3000;

export function createServer() {
  const app = framework();

  app.use(framework.json({ limit: '4mb' }));
  app.use('/',    framework.static(join(ROOT, 'public')));
  app.use('/',    framework.static(join(ROOT, 'src')));
  app.use('/xml', framework.static(join(ROOT, 'xml')));

  registerHealthRoute(app);
  registerXmlRoute(app);
  registerAIRoute(app);

  return app;
}

export function listen(app, port) {
  const listenPort = port ?? Number(DEFAULT_PORT);
  return new Promise((resolve, reject) => {
    const srv = app.listen(listenPort, () => {
      const p = srv.address().port;
      if (!port) console.log(`\n  Server  →  http://localhost:${p}\n`);
      resolve({
        server: srv,
        port:   p,
        url:    `http://localhost:${p}`,
        close:  () => new Promise((res, rej) => srv.close(err => err ? rej(err) : res())),
      });
    });
    srv.on('error', reject);
  });
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  listen(createServer());
}
