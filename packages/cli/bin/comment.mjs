#!/usr/bin/env node
// Entry ejecutable (`perfect-front` y alias `comment`). Registra tsx de forma
// programatica para poder correr los .ts del monorepo desde cualquier cwd, sin
// `--import tsx`. Pendiente: un build real para distribuir sin tsx.
import { register } from "tsx/esm/api";
import { fileURLToPath, pathToFileURL } from "node:url";

register();
const mainUrl = pathToFileURL(fileURLToPath(new URL("../src/main.ts", import.meta.url))).href;
try {
  const { main } = await import(mainUrl);
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err && (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "ERR_UNKNOWN_FILE_EXTENSION")) {
    process.stderr.write("No se pudo cargar el codigo TypeScript (falta tsx? ejecuta `pnpm install` en el repo).\n");
    process.exitCode = 1;
  } else {
    throw err;
  }
}
