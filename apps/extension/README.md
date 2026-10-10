# Chrome extension

Extensión Manifest V3 mínima. La capa de comentarios NO la inyecta la extensión: `perfect-front` arranca un proxy que añade `<script src="/__pf/overlay.js">` al HTML del proyecto, y el overlay corre en el mundo principal de la página exponiendo `window.__pf` (`version`, `enable()`, `disable()`, `isEnabled()`, `state`, `destroy()`). La extensión solo lista proyectos, los abre y enciende o apaga la capa.

## Desarrollo

```bash
pnpm --filter @perfect-front/extension build      # genera dist/ (cargable como unpacked)
pnpm --filter @perfect-front/extension dev        # build en modo watch
pnpm --filter @perfect-front/extension typecheck
pnpm --filter @perfect-front/extension test
```

Cargar: `chrome://extensions` > Modo desarrollador > Cargar descomprimida > `apps/extension/dist`.

## Flujo de uso

1. En la carpeta del proyecto: `perfect-front` (arranca el proxy y el servidor local, y registra el proyecto con la URL del proxy).
2. Abre el popup. Lista los servidores y proyectos con su estado y pendientes; tocar uno enfoca la pestaña con su URL (mismo origen) o abre una nueva. "Abrir dashboard" abre `http://127.0.0.1:<puerto>/`.
3. Switch "Capa de comentarios" (activo por defecto, persistente en `chrome.storage.local`): escribe `localStorage['pf:layer']` (`off` o se borra) y llama a `window.__pf.enable()/disable()` en las pestañas cuyo origen coincide con un proyecto.
4. Al terminar de cargar una pestaña de proyecto (`tabs.onUpdated`, `status: complete`) con el switch apagado, se re-aplica "apagada". Encendido no hace falta: el overlay arranca activo.

## Arquitectura

- **Service worker** (`src/background`): único que habla con los servidores. Valida `sender.id` (y rechaza remitentes con pestaña), cada mensaje y cada respuesta. Mensajes aceptados (protocolo de `packages/shared/src/messages.ts`): `pf/projects.list`, `pf/project.open`, `pf/layer.get`, `pf/layer.set`.
- **Descubrimiento** (`server.ts`): `GET /api/health` en paralelo en `127.0.0.1:45800..45820` (timeout 600 ms) y, por cada servidor que responde, `GET /api/projects` sin credenciales (el servidor reconoce el Origin fijo de la extensión). Caché ~2 s.
- **Coincidencia** (`match.ts`): una pestaña es de un proyecto si coincide el ORIGEN con `ProjectSummary.url` (la URL del proxy); `localhost`, `127.0.0.1` y `[::1]` cuentan como el mismo host.
- **Mundo MAIN** (`page-scripts.ts`): funciones autocontenidas (`probeLayer`, `setLayerInPage`) que `chrome.scripting.executeScript({ world: 'MAIN', func })` ejecuta en la página. No hay content script, ni `files`, ni `web_accessible_resources`.
- **Popup** (`src/popup`): TypeScript sin framework, solo `--pf-*` / `.pf-*`. Switch con `role="switch"` y `aria-checked`; todo es accesible por teclado.
- `src/local-protocol.ts`: contrato local del sondeo (`LayerProbe`), validado a mano (zod no es dependencia de esta app).

## "Esta pestaña" (diagnóstico real)

El popup sondea el mundo MAIN (`typeof window.__pf`, `isEnabled()`, versión) y muestra:

- (a) no hay servidores en ejecución;
- (b) la pestaña no es de ningún proyecto: se muestra la lista. `ProjectSummary` no trae la URL original del dev server, así que no se ofrece "Abrir por la capa" (ver pendientes);
- (c) pertenece a un proyecto y la capa está activa o apagada;
- (d) es del proyecto pero `window.__pf` no existe: "La capa no está cargada: recarga la página o revisa que el proxy esté activo".

Los fallos del worker se registran en su consola con el prefijo `[perfect-front]`.

## Permisos (mínimos)

- `storage`: preferencia global de la capa.
- `scripting`: solo `executeScript` con funciones pequeñas en el mundo MAIN, en pestañas de proyecto (worker) y en la pestaña activa (popup, sondeo).
- `host_permissions`: únicamente `http://localhost/*` y `http://127.0.0.1/*`. Con ellas Chrome entrega `tab.url` y `scripting` puede ejecutar: no hacen falta `tabs`, `activeTab` ni `webNavigation`. `[::1]` queda fuera (no verificado como patrón); una pestaña ahí se reconoce como el mismo host pero no se puede ejecutar código en ella.
- Sin `content_scripts` ni `web_accessible_resources`.

## Build

`scripts/build.mjs` usa la API JS de Vite: dos builds (worker ES y popup HTML) y manifest generado, sin `@crxjs`.

## ID de extensión

El servidor autoriza `chrome-extension://<id>`, así que el ID debe ser estable. `extension-key.json` contiene la clave PÚBLICA que `build.mjs` pone como `key` en el manifest; el ID resultante es `joggpgkomcopmidkklfcapadaipimjef` (`OFFICIAL_EXTENSION_ID`). No hay clave privada (no sirve para publicar en la Web Store; para eso se generará otra).
