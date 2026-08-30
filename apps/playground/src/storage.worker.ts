/**
 * The storage worker's entry point.
 *
 * A one-line file because the worker itself lives in `@fonteditor/storage`,
 * which deliberately has no opinion about how a worker URL is spelled — that is
 * a bundler question. Vite recognises `new Worker(new URL("./…", import.meta.url))`
 * pointing at a local module, so this file exists to be that local module.
 */
import "@fonteditor/storage/worker";
