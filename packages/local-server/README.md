# Local server

API ligada a loopback para proyectos, comentarios, eventos y procesos. Es el unico modulo autorizado para convertir un proyecto registrado en una ruta del filesystem.

Entry ejecutable: `src/bin.ts` (`node --import tsx packages/local-server/src/bin.ts [--state-dir <dir>] [--port <n>]`). Llama a `startServer`, escribe `discovery.json` y lo borra al cerrar con SIGINT/SIGTERM. Normalmente lo lanza `comment server start` (ver `packages/cli/README.md`, "Probar con Chrome").

`--owner-pid <pid>`: el servidor se cierra solo (borrando discovery.json) si ese PID desaparece; lo usa el modo primer plano del CLI. `DELETE /api/projects/:id` (solo CLI) des-registra un proyecto sin tocar sus comentarios.

Confianza: la extension oficial se reconoce por su Origin exacto `chrome-extension://<OFFICIAL_EXTENSION_ID>` (el navegador lo impone; una pagina no puede falsificarlo) y obtiene el rol `extension` sin token: `GET /api/health`, `GET /api/projects`, comentarios, colecciones y `GET /api/events`. Nunca registrar/borrar proyectos, procesos ni logs (403). IDs adicionales de desarrollo: `PF_EXTENSION_IDS=<id>[,<id>]` o la opcion `extensionIds` (un ID invalido hace fallar el arranque). Cualquier otro Origin de extension recibe 403 en todo. Sin Origin siempre se exige token.

## Dashboard (`/`)

Sirve el build de `apps/dashboard/dist` (`pnpm --filter @perfect-front/dashboard build`; opcion `dashboardDir` para cambiar la carpeta). Solo `GET`/`HEAD`, con fallback SPA a `index.html` para rutas sin extension; los recursos con extension inexistentes dan 404 y `/api/*` no se ve afectado (un `/api/...` desconocido sigue siendo 404 JSON). Se rechazan traversal (`..`, `%2e%2e` decodificado, `\`, bytes nulos), dotfiles y enlaces simbolicos que escapen de `dist`. Sin build responde 503 en texto plano indicando el comando.

Token del dashboard: al servir `index.html` se escribe el token de **sesion** (nunca el del CLI) en `<meta name="pf-token">`, solo si `canInjectToken` (en `src/static.ts`) lo permite:

- Host loopback con el puerto propio (DNS rebinding: `Host: atacante.com` ya se rechaza antes y nunca hay token).
- `Origin` ausente o exactamente el origen del servidor. Otra pagina loopback (p. ej. la app revisada en `localhost:3000`) es valida para la API pero no puede leer el token con `fetch` CORS.
- `Sec-Fetch-Site`, si existe, `same-origin` o `none` (cubre `<iframe>`, `<script src>` ajenos).
- Respuesta con `Cache-Control: no-store`, `X-Frame-Options: DENY` y CSP (`frame-ancestors 'none'`, sin scripts externos).

El rol `session` no cambia: puede lo que ya podia (leer/gestionar comentarios, iniciar/detener procesos y ver logs) y **no** registrar ni borrar proyectos (solo `cli`).

Endpoints añadidos (compatibles con los contratos de `shared`):

- `GET /api/projects/:id/comments/:commentId/attachments/:file`: captura del comentario. Requiere token (el rol `extension` recibe 403); solo archivos declarados en `attachments` del comentario, nombre plano, extension png/jpg/webp, MIME comprobado con la firma binaria (422 si no coincide) y limite de tamaño; sin traversal.
- Cabecera opcional `X-PF-Expected-Updated-At` en `PATCH .../comments/:commentId`: si el `updatedAt` actual difiere, `409 conflict` sin escribir (control de conflictos entre pestañas).
- Cabecera opcional `X-PF-Include-Corrupt: 1` en el listado de comentarios: añade `corrupt: [{collection, file, code, message}]` con los JSON ilegibles (sin ella la respuesta es la de siempre).
