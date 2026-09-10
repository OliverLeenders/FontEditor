/**
 * The storage worker's entry point.
 *
 * One line, because the worker itself lives in `@typewright/storage`, which has
 * no opinion about how a worker URL is spelled — that is a bundler question.
 * Vite recognises `new Worker(new URL("./…", import.meta.url))` pointing at a
 * local module, so this file exists to be that local module.
 */
import "@typewright/storage/worker";
