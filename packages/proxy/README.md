# @perfect-front/proxy

Proxy HTTP local que se coloca delante del servidor de desarrollo (o de un servidor estático) e inyecta la capa de Perfect Front en cada página HTML. La capa habla con la API en el **mismo origen** (`/__pf/*`), sin extensión ni CORS.

```ts
import { startProxy } from "@perfect-front/proxy";

const proxy = await startProxy({
  target: { host: "localhost", port: 5173 },
  projectId: "proj_...",
  localServer: { baseUrl: "http://127.0.0.1:4777", token: "<token del servidor local>" },
  getOverlayScript: async () => readFile("overlay.js", "utf8"), // se llama en cada petición
});
console.log(proxy.url); // http://127.0.0.1:7788
await proxy.close();
```

`listenPort` omitido: primer puerto libre desde 7788 hasta +50. Siempre escucha en `127.0.0.1`.

## Qué hace

- Respuestas `text/html` (cualquier status): se bufferizan y se inyecta
  `<script src="/__pf/overlay.js" data-pf-token="<token>" data-pf-base="/__pf" defer></script>`
  antes de `</head>` (si no, antes de `</body>`, si no al inicio). Es idempotente, recalcula `content-length` y fuerza `cache-control: no-store`.
- Todo lo demás (JS, CSS, imágenes, JSON, SSE, streaming) pasa por `pipe` sin bufferizar. Soporta HEAD y cualquier método con cuerpo.
- Reescribe `Host` hacia el destino y los `Location` que apunten al destino hacia el origen del proxy.
- WebSocket / upgrade (HMR de Vite): túnel de sockets crudos (`net`); solo se reescribe `Host`. Las rutas `/__pf/` nunca se tunelan.
- Destino caído: `502 text/plain` con un mensaje claro.
- `close()` cierra el servidor y todos los sockets activos (clientes, destino, WS, SSE). Es idempotente.

## Rutas propias (`/__pf/`, jamás se reenvían al destino)

| Ruta | Auth | Descripción |
|---|---|---|
| `GET /__pf/overlay.js` | no | `await getOverlayScript()`; si lanza, 500 de texto con el mensaje |
| `GET /__pf/health` | no | `{ "ok": true }` |
| `GET /__pf/comments` | token + Origin | lista mínima para pins (`id, status, scope, comment, location{route,selector,selectorCandidates}, elementRect, createdAt`) |
| `POST /__pf/comment` | token + Origin | valida con `CreateCommentRequestSchema` (máx. ~14 MB) y devuelve `CommentCreatedData` |

Respuestas JSON: `{ ok: true, data }` o `{ ok: false, error: { code, message, details? } }` (errores de `@perfect-front/shared`, sin stack). Cualquier otra ruta bajo `/__pf/` es 404 (405 si el método no corresponde). El proxy solo llama a `GET|POST {localServer}/api/projects/{projectId}/comments`; la página no puede elegir ruta ni `projectId`.

## Seguridad

- `Host` debe ser loopback (`127.0.0.1`, `localhost`, `[::1]`) con el puerto del proxy (anti DNS rebinding); si no, 403.
- Lecturas y escrituras de comentarios exigen `X-PF-Token` igual al token del proxy (comparación en tiempo constante) y `Origin` ausente o igual a `http://<Host>` de la petición.
- El token del servidor local solo viaja del proxy al servidor local (`Authorization: Bearer`); nunca llega a la página ni a los logs (se redacta).

## Riesgos y limitaciones

- **El origen cambia**: la app se sirve desde `http://127.0.0.1:<puerto>` en vez del puerto del dev server. `localStorage`, cookies y orígenes permitidos (OAuth, CORS del backend) quedan separados de los del origen original.
- **HTTPS**: el destino se contacta por HTTP plano. Un destino solo-HTTPS no está soportado, y los `Location` a `https://` se dejan intactos.
- **Compresión**: se elimina `accept-encoding` hacia el destino para recibir HTML sin comprimir. Si el HTML llega comprimido igualmente (`content-encoding`), no se toca, no se inyecta y se avisa por log. Las páginas con charset UTF-16 tampoco se inyectan.
- **CSP**: si el destino envía `Content-Security-Policy` con `script-src`/`default-src`, no se modifica (se avisa por log) y el navegador puede bloquear `/__pf/overlay.js`.
- HEAD sobre HTML no lleva `content-length` (el GET real crece al inyectarse).
- Cada petición abre su propia conexión al destino (sin keep-alive): suficiente para desarrollo local.

## Desarrollo

```
pnpm exec vitest run packages/proxy
pnpm exec tsc --noEmit -p packages/proxy
```
