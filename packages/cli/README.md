# CLI

Binario `perfect-front` (alias `comment`; `bin/comment.mjs` -> `src/main.ts`). Ver `comment --help`.

Codigos de salida: 0 ok, 1 interno, 2 uso, 3 proyecto, 4 proceso, 5 no activo, 6 id no encontrado, 7 conflicto/revision obsoleta, 8 datos/almacenamiento, 130 Ctrl+C.

## Comentarios por CLI y agentes (sin servidor ni navegador)

`list`, `show`, `claim`, `resolve`, `edit`, `move`, `status <id> <estado>`, `ignore`, `reopen` y `export` operan directo sobre `<proyecto>/.perfect-front` (`src/comments.ts`). Salida `--json` estable, bloqueo optimista con `--expect-updated-at` y codigos de salida documentados. Contrato completo, flujo para agentes y bloque para pegar en el CLAUDE.md de un proyecto: [AGENTS.md](./AGENTS.md).

## Servidor local de Perfect Front

`perfect-front` (alias `comment`) sin subcomando corre en PRIMER PLANO: detecta el proyecto del directorio actual, inicia el dev server (hijo administrado) y el servidor local, registra el proyecto (`POST /api/projects/register` con el token de CLI, sin Origin), abre el navegador, pone el proxy con la capa de comentarios delante del dev server (ver "Proxy y capa de comentarios"), imprime la URL del proyecto (la del proxy), la URL original, el estado del servidor local y "Capa de comentarios activa: Alt+clic sobre un elemento (o Ctrl/Cmd+Mayús+C)", y se queda vivo. La extension oficial se reconoce por su ID fijo (Origin del navegador), sin configuracion; para probar una build con otro ID, `PF_EXTENSION_IDS=<id>[,<id>]` al arrancar el servidor local. Ctrl+C, cerrar la terminal (SIGHUP/SIGBREAK) o SIGTERM apagan todo lo que inicio: mata el arbol del dev server, cierra el proxy, des-registra el proyecto y, si es duena del servidor local, lo cierra y borra su estado. No hace falta ningun comando de stop. Si el dev server propio termina, la sesion se apaga con codigo 4.

Opciones utiles: `--no-open`, `--no-server` (solo dev server; sin servidor local tampoco hay proxy), `--no-proxy` (sin proxy ni capa), `--server-port <n>`, `--detach` (segundo plano, abre el navegador y regresa). Subcomandos que siguen existiendo: `start` (segundo plano, sin abrir navegador), `status`, `stop`, `restart`, `logs`, `open`, `server start|stop|status|logs`. `server stop` y `stop` solo terminan procesos iniciados por Perfect Front (PID + hora de inicio verificados); `stop` tambien detiene el proxy administrado.

## Proxy y capa de comentarios

Cuando el dev server (o el servidor estatico) esta listo, el CLI arranca `@perfect-front/proxy` delante: escucha en `127.0.0.1:7788` (si esta ocupado, el siguiente libre), reenvia todo al destino real e inyecta `<script src="/__pf/overlay.js">` en el HTML. La capa habla con el servidor local a traves del proxy en el mismo origen (`/__pf/*`), sin extension. El proyecto se registra con `url` = URL del proxy (conservando la ruta/pagina elegida en estatico) y `targetUrl` = URL original; el navegador se abre en la URL del proxy. Tambien tras reiniciar el servidor local, el registro conserva ambas.

- **Donde vive**: en primer plano, dentro del propio proceso de la sesion (se cierra con ella; sin hijos extra ni huerfanos). En `start`/`--detach` es un hijo administrado (`src/proxy/bin.ts`, como el servidor estatico) que sobrevive al comando: `stop`/`restart` lo detienen, un segundo `start` lo reutiliza, y si el dev server es administrado un vigilante (`bin/guard.mjs`) lo cierra si este muere. Con un dev server externo el proxy dura hasta `stop`.
- **Estado**: `<raiz>/.perfect-front/run/proxy.json` (pid, hora de inicio, puerto, URL original; sin tokens) y `proxy.log` para el hijo. `status` lo muestra.
- **Token**: el del servidor local se lee de `discovery.json` solo para el proxy (nunca se imprime ni llega a la pagina; la pagina recibe un token propio del proxy). Si el servidor local se reinicia, el proxy se reinicia en el mismo puerto con las credenciales nuevas (recarga la pagina).
- **Overlay**: se construye una vez al arrancar y se cachea. Para desarrollar el overlay: `PF_OVERLAY_NO_CACHE=1` (o la opcion oculta `--overlay-no-cache`) lo reconstruye en cada peticion.
- **Servidor local antiguo**: antes de reutilizar un servidor vivo se exige que `GET /api/health` anuncie `features` con `proxy-v1` (`REQUIRED_SERVER_FEATURES`). Si falta y lo inicio Perfect Front, se apaga, se arranca uno nuevo y se re-registra (las otras sesiones lo detectan y re-registran); un registro con `targetUrl` rechazado (4xx) se trata igual. Si no lo inicio Perfect Front, nunca se mata: sigue sin proxy y avisa.
- **Nunca en silencio**: si no hay capa se imprime `SIN CAPA DE COMENTARIOS: <motivo> — <que hacer>` y `--json` trae `proxy: { active: false, reason }`.
- **`--no-proxy`**: sin proxy no hay capa (la extension ya no la inyecta); se registra la URL original.
- **Cambio de origen**: la app se sirve desde `http://127.0.0.1:<puerto del proxy>`; `localStorage`, cookies y orígenes permitidos (OAuth, CORS del backend) quedan separados de los del dev server. Si tu app depende de ellos, usa `--no-proxy`.
- **Limitaciones**: solo destinos HTTP (con HTTPS no hay capa y se avisa); si el destino envia `Content-Security-Policy` con `script-src`/`default-src` el navegador puede bloquear el script; HTML que llega comprimido pese a quitar `accept-encoding`, o en UTF-16, no se inyecta. Detalle en `packages/proxy/README.md`.

### Varias terminales y duenos

La primera sesion es duena del servidor local; las siguientes se registran en el existente y al salir solo des-registran su proyecto (el proyecto se conserva si otra sesion sigue usando la misma carpeta). Cada sesion revisa el servidor cada segundo: si el dueno cae, la primera que lo nota lo relanza (con un bloqueo `server.lock` para que no haya dos), se vuelve duena y vuelve a registrar su proyecto. Los comentarios viven en `<proyecto>/.perfect-front`, asi que no se pierden.

### Si el proceso muere sin limpiar (kill -9, `taskkill /F`)

Node puro no tiene Job Objects, asi que hay vigilancia del padre: el servidor local recibe `--owner-pid` y se cierra solo (borrando discovery.json) en ~1 s si su dueno desaparece; el dev server queda vigilado por `bin/guard.mjs`, un proceso minimo que mata su arbol cuando muere la sesion. En el siguiente arranque se podan sesiones muertas (`<estado>/sessions/`) y un dev server huerfano (su `process.json` guarda `ownerPid`) se detiene y se reinicia. Limites: la vigilancia solo comprueba que el PID del dueno siga vivo (un PID reciclado la enganaria); `taskkill` sin `/F` no puede terminar procesos de consola de Node (Windows lo rechaza), use Ctrl+C; `process.kill(pid, "SIGINT")` en Windows termina sin handlers (en pruebas se usa un canal IPC `"shutdown"`).

## HTML estatico (carpeta con .html sin runner)

Si la carpeta no tiene Vite (ni otro runner conocido, ni scripts `dev`/`start`, ni `--command`/`--url`) pero si `.html`, `perfect-front` la sirve con su propio servidor estatico (`src/static/`, solo `node:http`) como proceso administrado igual que el dev server: mismo estado (`process.json`/`process.log`), apagado con Ctrl+C, vigilante del padre (`bin/guard.mjs`) y registro en el servidor local. No hace falta `package.json`: sin el, la raiz del proyecto es la carpeta actual.

Que pagina se abre (la URL abierta y registrada es la de esa pagina; el comentario guarda su ruta en `location.route`):

1. `--page <ruta>` o `entry` de `.perfect-front/project.json`.
2. `index.html` en la raiz: manda sobre todos los demas.
3. Un unico `.html`: se elige solo.
4. Varios sin `index.html`: hay que escoger. En terminal (TTY) aparece una lista numerada (flechas o numero, Enter confirma, Ctrl+C cancela con codigo 130 sin dejar procesos) y despues pregunta si recordar la eleccion; solo con `s` escribe `entry` en `<proyecto>/.perfect-front/project.json` (lo crea con `{ "version": 1, "entry": ... }` si no existe y conserva los demas campos; nunca pisa un archivo invalido). Sin TTY o con `--json` NO adivina: imprime la lista y sale con codigo 2 (`--page <ruta>`; en JSON `{"ok":false,"pages":[...],"hint":...}`).

Opciones: `--page <ruta>` (debe estar en la lista de candidatas; nunca absolutas ni `..`), `--choose` (ignora `entry` e `index.html` y obliga a elegir de nuevo), `--port <n>` (puerto preferido; por defecto 5500 y, si esta ocupado, el siguiente libre; el puerto final se anuncia), `--fallback <ruta.html>` (desactivado por defecto: sirve esa pagina para rutas sin extension que no existen, tipo SPA).

Candidatas: `.html` de la raiz; si no hay ninguno, subcarpetas hasta profundidad 2, ignorando `node_modules`, `dist`, `build`, `.git`, `.perfect-front` y carpetas con punto; maximo 200 (se avisa si se trunca).

Servidor estatico: enlazado a `127.0.0.1`; solo GET/HEAD (otros metodos: 405); rechaza `..` (tambien `..%2f`), barras invertidas, NUL y `:` en la ruta; resuelve con `realpath` y rechaza symlinks/junctions que salgan de la raiz o apunten a zonas bloqueadas; no sirve dotfiles, `.perfect-front/` ni `node_modules`; sin listado de directorios (un directorio solo sirve su `index.html`; sin barra final redirige con 301); exige `Host` loopback (contra DNS rebinding); `X-Content-Type-Options: nosniff` y MIME por extension. Limite conocido: sin soporte de `Range` ni compresion.

Precedencia: configuracion explicita (`--command`, `--url`, `command`/`url` en project.json) y Vite ganan sobre el modo estatico.

## Instalar el comando global (Windows)

pnpm 11 no tiene `pnpm link --global`; el equivalente (carpeta enlazada, sin copiar) es, desde la raiz del repo:

```powershell
pnpm add --global "link:Z:\Dev\perfect-front\packages\cli"
```

Si falla con `global bin directory ... is not in PATH`, ejecuta una vez `pnpm setup` y abre una terminal nueva (Perfect Front no modifica tu PATH). Verifica desde cualquier carpeta: `perfect-front --help`. Desinstalar: `pnpm remove --global @perfect-front/cli`. Sigue usando el codigo del repo (sin build): el bin registra tsx por codigo (`tsx/esm/api`), por eso `tsx` es dependencia del paquete; si mueves el repo, repite el comando.

## Probar con Chrome (Windows, sin build)

1. En la raiz del repo: `pnpm install` e instala el comando global (seccion anterior).
2. En la carpeta de tu proyecto: `perfect-front`. Imprime la URL del proyecto (la del proxy) y abre el navegador ahi.
3. Alt+clic sobre un elemento (o Ctrl/Cmd+Mayús+C) y comenta. Para salir: Ctrl+C en esa terminal (o cierrala).

La extension es opcional (lista los proyectos, abre/enfoca pestanas y alterna la capa): `pnpm --filter @perfect-front/extension build`, `chrome://extensions` -> Modo de desarrollador -> "Cargar descomprimida" -> `apps\extension\dist`.

Sin instalar el comando global, desde la raiz del repo: `node packages\cliin\comment.mjs --cwd C:
uta\proyecto`.

## Ejecucion en desarrollo

`bin/comment.mjs` registra tsx programaticamente y carga `src/main.ts` desde cualquier cwd. Los tests usan Vitest.

## Estado

Metadata minima en `<raiz>/.perfect-front/run/process.json` (y `proxy.json`; escritura atomica) y salida en `process.log` (se trunca en cada inicio; solo se lee la cola de 64 KB). Es por proyecto y queda dentro de `.perfect-front/`, como exige la SPEC. `comment stop` solo termina un PID cuya hora de inicio coincide con la registrada (evita PIDs reciclados); un servidor externo nunca se toca.
