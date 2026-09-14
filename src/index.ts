/** Server bootstrap. */

import { createApp } from "./app.js";
import { DEFAULT_PORT } from "./http/config.js";

function listenPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      `PORT must be an integer from 1 to 65535, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

const port = listenPort(process.env["PORT"]);

const app = createApp();

const server = app.listen(port, () => {
  console.log(`MP3 File Analysis App listening on http://localhost:${port}`);
  console.log(
    'POST an MPEG-1 Layer III file to /file-upload (multipart field: "file")',
  );
});

const SHUTDOWN_SIGNALS = [
  "SIGINT",
  "SIGTERM",
] as const satisfies readonly NodeJS.Signals[];

for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
