// Build manual con la API JS de Vite: 2 builds (worker ES, popup HTML) + manifest generado.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");
const define = { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") };
const common = { configFile: false, logLevel: "warn", root, define };

const lib = (entry, fileName, format, emptyOutDir) =>
  build({
    ...common,
    build: {
      outDir: dist,
      emptyOutDir,
      minify: !watch,
      sourcemap: watch,
      watch: watch ? {} : null,
      lib: { entry: resolve(root, entry), formats: [format], name: "pfBackground", fileName: () => fileName },
    },
  });

await lib("src/background/index.ts", "background.js", "es", true);
await build({
  ...common,
  base: "./",
  root: resolve(root, "src/popup"),
  build: {
    outDir: resolve(dist, "popup"),
    emptyOutDir: true,
    minify: !watch,
    watch: watch ? {} : null,
    rollupOptions: { input: resolve(root, "src/popup/index.html") },
  },
});

const { key } = JSON.parse(readFileSync(resolve(root, "extension-key.json"), "utf8"));
const manifest = {
  manifest_version: 3,
  name: "Perfect Front",
  version: "0.0.0",
  description: "Comentarios visuales sobre tu app local, guardados en tu proyecto.",
  minimum_chrome_version: "116",
  key,
  permissions: ["storage", "scripting"],
  host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
  background: { service_worker: "background.js", type: "module" },
  action: { default_title: "Perfect Front", default_popup: "popup/index.html" },
};
mkdirSync(dist, { recursive: true });
writeFileSync(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("extension built ->", dist);
