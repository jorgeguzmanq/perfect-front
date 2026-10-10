import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

interface DiscoveryInfo {
  port: number;
  token: string;
}

/** Misma ubicacion que `defaultStateDir()` de local-server. */
function stateDir(): string {
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "perfect-front");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "perfect-front");
  return path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "perfect-front");
}

function readDiscovery(): DiscoveryInfo | null {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(stateDir(), "discovery.json"), "utf8")) as Partial<DiscoveryInfo>;
    return typeof d.port === "number" && typeof d.token === "string" ? { port: d.port, token: d.token } : null;
  } catch {
    return null;
  }
}

/** Solo en `vite dev`: inyecta el token de SESION (nunca el del CLI) como lo hace el servidor local en produccion. */
function devToken(): Plugin {
  return {
    name: "pf-dev-token",
    apply: "serve",
    transformIndexHtml: (html) => {
      const d = readDiscovery();
      return d ? html.replace(/<meta name="pf-token"[^>]*>/, `<meta name="pf-token" content="${d.token}" />`) : html;
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), devToken()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${(command === "serve" ? readDiscovery()?.port : null) ?? 45800}`,
        changeOrigin: true,
      },
    },
  },
}));
