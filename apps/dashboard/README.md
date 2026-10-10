# Dashboard

Aplicacion web local (Vite + React 19) para ver y gestionar los comentarios de los proyectos registrados. La sirve `@perfect-front/local-server` en `http://127.0.0.1:<puerto>/`.

```bash
pnpm --filter @perfect-front/dashboard build      # genera dist/ (lo sirve el servidor local)
pnpm --filter @perfect-front/dashboard dev        # Vite en :5174 con proxy a la API local
pnpm --filter @perfect-front/dashboard typecheck
pnpm --filter @perfect-front/dashboard test
```

En `dev`, el plugin de `vite.config.ts` lee `discovery.json` (puerto y token de sesion) para el proxy y la meta `pf-token`; hay que tener el servidor local corriendo.

## Autenticacion

El servidor inyecta el token de **sesion** en `<meta name="pf-token">` al servir `index.html` solo para Host loopback con el puerto propio y peticiones same-origin o sin Origin (defensa anti DNS-rebinding y contra lectura cross-origin/CSRF; detalle en `packages/local-server/README.md`). El cliente (`src/api/client.ts`) envia `Authorization: Bearer`; el SSE usa `?access_token=` porque `EventSource` no admite cabeceras. Las capturas se piden con Bearer y se muestran como blob local.

## Seguridad de la UI

El HTML capturado se muestra siempre como texto en `<pre><code>` (nunca `dangerouslySetInnerHTML`). "Abrir comentario en la pagina" solo navega a URLs http(s) y con `noopener,noreferrer`.

## Estilos

Solo `@perfect-front/design-tokens`: variables `--pf-*` y clases `.pf-*` (sin Tailwind). Respeta `prefers-color-scheme` y `prefers-reduced-motion`.

## Pendiente

- Renombrar colecciones: no existe operacion en `comment-storage`/API (solo crear).
- Logs de procesos en la UI (el endpoint existe) y reintentar localizar el elemento en la pagina.
- Lista virtualizada: solo si las mediciones lo justifican (Fase 8).
