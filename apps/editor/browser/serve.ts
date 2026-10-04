import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { preview } from "vite";

import { PORT } from "./harness.js";

/**
 * The built editor, served for as long as the browser tests run.
 *
 * `vite preview`, which is what serves `dist/` under the content security
 * policy the desktop window has — so a test that passes here passed with the
 * policy in force. On a port of its own: not the development server's, where
 * somebody's font is open, and not the preview's usual one, whose storage
 * somebody may have tried the build in.
 */
export default async function serve(): Promise<() => Promise<void>> {
  const root = fileURLToPath(new URL("..", import.meta.url));
  if (!existsSync(fileURLToPath(new URL("../dist/index.html", import.meta.url)))) {
    throw new Error(
      "The editor is not built: there is no dist/index.html. `pnpm test:browser` builds it first.",
    );
  }

  const server = await preview({
    root,
    logLevel: "warn",
    preview: { host: "127.0.0.1", port: PORT, strictPort: true },
  });
  return () => server.close();
}
