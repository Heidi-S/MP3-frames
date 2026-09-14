/** Server bootstrap. */

import { createApp } from './app.js';
import { DEFAULT_PORT } from './http/config.js';

const port = Number.parseInt(process.env['PORT'] ?? '', 10) || DEFAULT_PORT;

const app = createApp();

const server = app.listen(port, () => {
  console.log(`MP3 File Analysis App listening on http://localhost:${port}`);
  console.log('POST an MPEG-1 Layer III file to /file-upload (multipart field: "file")');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
