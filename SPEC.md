# Perfect Front — Especificación de producto y arquitectura

## 1. Resumen

Perfect Front es una herramienta local de revisión visual para proyectos web. Permite abrir una aplicación en Chrome, activar una capa de comentarios sobre la página renderizada, seleccionar elementos y registrar observaciones sin modificar el código ni instalar componentes dentro del proyecto observado.

La experiencia principal comienza desde la raíz de cualquier proyecto:

```bash
comment
```

El comando detecta el tipo de proyecto, encuentra o inicia su servidor de desarrollo, registra temporalmente la relación entre la URL y la carpeta local, abre la aplicación en Chrome y conecta la extensión de Perfect Front.

Cada comentario pertenece al proyecto revisado y se persiste dentro de él como un archivo JSON independiente. Perfect Front no utiliza una base de datos externa como fuente de verdad.

## 2. Objetivos

Perfect Front debe permitir:

1. Ejecutar `comment` desde la raíz de un proyecto.
2. Detectar proyectos Vite, Next.js, Angular y HTML estático.
3. Conectarse a un servidor ya levantado o iniciar uno nuevo.
4. Abrir el proyecto en Chrome.
5. Alternar entre la vista normal y el modo de comentarios desde una extensión.
6. Seleccionar cualquier elemento visible sin importar el framework.
7. Crear comentarios de elemento o de página completa.
8. Guardar cada comentario dentro del proyecto observado.
9. Leer, editar, organizar, mover y resolver comentarios desde una aplicación web local.
10. Permitir que una persona o un agente de código procese comentarios pendientes.
11. Conservar suficiente contexto para volver a encontrar el elemento aunque la aplicación cambie parcialmente.
12. Funcionar sin agregar imports, plugins o componentes a la aplicación observada.

## 3. Principios del producto

### 3.1 El proyecto es dueño de sus comentarios

Los comentarios viven en la carpeta del proyecto que se está revisando. La extensión y el servidor local solo los crean, leen y organizan.

Esto permite:

- mantener el feedback junto al código;
- procesarlo con cualquier editor o agente;
- decidir si se versiona con Git o se ignora;
- transportar el proyecto sin perder sus comentarios;
- evitar una cuenta, nube o base de datos obligatoria.

### 3.2 Un comentario es un archivo

No se utilizará un único `comments.json` con un arreglo gigante. Cada comentario tendrá su propio archivo JSON.

Beneficios:

- no se necesitan delimitadores de texto;
- mover un comentario equivale a mover un archivo;
- se reducen los conflictos de escritura y de Git;
- un agente puede procesar comentarios individualmente;
- los adjuntos y el historial pueden relacionarse mediante un ID estable.

### 3.3 La extensión es la capa de interacción

La extensión de Chrome selecciona elementos y captura contexto. No administra procesos ni escribe directamente en el filesystem.

### 3.4 El servidor local es el puente

Un proceso local de Node.js relaciona URLs con carpetas, administra servidores de desarrollo y realiza las operaciones de filesystem.

### 3.5 El dashboard es una web

Perfect Front no requiere Electron. La administración de proyectos y comentarios ocurre en una aplicación web local servida por el propio proceso de Perfect Front.

## 4. Arquitectura general

```text
┌─────────────────────────────────────────────────────────────────┐
│ Chrome                                                          │
│                                                                 │
│  ┌─────────────────────┐      ┌───────────────────────────────┐ │
│  │ Aplicación revisada │      │ Dashboard de Perfect Front    │ │
│  │ localhost:5173      │      │ localhost:45800               │ │
│  │                     │      │                               │ │
│  │ + overlay inyectado │      │ proyectos y comentarios      │ │
│  └──────────┬──────────┘      └───────────────┬───────────────┘ │
│             │ Extensión MV3                   │ HTTP/WebSocket   │
└─────────────┼─────────────────────────────────┼─────────────────┘
              └────────────────┬────────────────┘
                               ▼
                   ┌────────────────────────┐
                   │ Servidor local         │
                   │ Perfect Front          │
                   │                        │
                   │ procesos · API · FS    │
                   └───────────┬────────────┘
                               ▼
                   ┌────────────────────────┐
                   │ Raíz del proyecto      │
                   │ .perfect-front/        │
                   └────────────────────────┘
```

### 4.1 Componentes

#### CLI `comment`

Responsabilidades:

- usar el directorio actual como raíz por defecto;
- localizar la raíz real si se ejecuta desde un subdirectorio;
- detectar framework, gestor de paquetes y comando de desarrollo;
- detectar un servidor existente;
- iniciar el servidor local de Perfect Front si no está activo;
- iniciar el servidor del proyecto cuando sea necesario;
- registrar proyecto, proceso, puerto y URL;
- abrir Chrome o imprimir la URL;
- ofrecer comandos para listar, mover y resolver comentarios.

#### Servidor local

Responsabilidades:

- servir el dashboard;
- exponer una API HTTP local;
- emitir cambios por WebSocket o Server-Sent Events;
- mantener el registro de proyectos de la sesión;
- iniciar, observar y detener procesos hijos;
- escribir comentarios de forma atómica;
- validar todas las rutas antes de acceder al filesystem;
- aceptar peticiones únicamente desde orígenes locales autorizados.

#### Extensión de Chrome

Responsabilidades:

- detectar si la pestaña corresponde a un proyecto registrado;
- alternar modo normal y modo comentarios;
- inyectar el overlay usando Manifest V3;
- aislar su interfaz dentro de Shadow DOM;
- resaltar el elemento bajo el cursor;
- capturar contexto DOM y visual;
- enviar comentarios al servidor local;
- enlazar al dashboard y al proyecto activo.

#### Overlay

Responsabilidades:

- selección de elementos;
- navegación entre elemento, padre e hijo;
- comentario sobre elemento o vista completa;
- captura de selector, texto, HTML y geometría;
- formulario de comentario;
- confirmación de guardado;
- no interferir con eventos de la aplicación cuando esté desactivado.

#### Dashboard

Responsabilidades:

- listar proyectos conocidos y activos;
- iniciar, detener y reiniciar proyectos administrados;
- abrir sus URLs;
- mostrar logs básicos;
- listar comentarios por colección y estado;
- leer y editar comentarios;
- mover comentarios entre colecciones;
- marcar comentarios como pendientes, en progreso, resueltos o ignorados;
- abrir la ruta relacionada con un comentario;
- visualizar captura, selector y contexto HTML;
- exportar reportes opcionales.

## 5. Flujo principal

### 5.1 Inicio desde un proyecto

```powershell
cd Z:\Dev\mi-proyecto-vite
comment
```

Perfect Front debe:

1. Resolver `Z:\Dev\mi-proyecto-vite` como raíz.
2. Leer la configuración local si existe.
3. Detectar que el proyecto utiliza Vite.
4. Detectar `pnpm`, `npm`, `yarn` o `bun` mediante el lockfile y `packageManager`.
5. Buscar un servidor compatible ya activo.
6. Ejecutar, si hace falta, el script `dev` del proyecto.
7. Esperar hasta que la URL responda.
8. Registrar la relación entre URL y raíz local.
9. Abrir la URL en Chrome.
10. Informar a la extensión que la pestaña pertenece al proyecto.

Salida esperada:

```text
Perfect Front

✓ Proyecto: mi-proyecto-vite
✓ Detectado: Vite + React
✓ Comando: pnpm dev
✓ Aplicación: http://localhost:5173
✓ Comentarios: .perfect-front/comments/inbox/
✓ Dashboard: http://localhost:45800

Abriendo Chrome…
```

### 5.2 Creación de un comentario

1. El usuario abre el popup de la extensión.
2. Activa “Comentar esta página”.
3. El overlay comienza a inspeccionar elementos.
4. El usuario selecciona un elemento.
5. Escribe el comentario.
6. La extensión captura el contexto.
7. Envía el payload al servidor local.
8. El servidor identifica el proyecto mediante la URL y el registro de sesión.
9. Valida que la raíz sea una carpeta registrada.
10. Crea un ID estable.
11. Escribe el JSON de forma atómica en `inbox/`.
12. Notifica al dashboard.
13. La extensión confirma el guardado.

### 5.3 Resolución

Un comentario puede resolverse manualmente o mediante un agente.

Flujo esperado:

```text
pending → in_progress → resolved → archived
```

Al resolverlo se debe registrar:

- fecha de resolución;
- resumen del cambio;
- archivos modificados, si se conocen;
- identidad opcional del responsable;
- notas de verificación;
- commit opcional.

El JSON se mueve a la colección `resolved/` o a la colección configurada por el usuario.

## 6. Persistencia

### 6.1 Estructura por proyecto

```text
mi-proyecto/
└── .perfect-front/
    ├── project.json
    ├── comments/
    │   ├── inbox/
    │   │   ├── pf_01K7A.json
    │   │   └── pf_01K7B.json
    │   ├── mobile/
    │   │   └── pf_01K6Z.json
    │   ├── redesign/
    │   ├── resolved/
    │   └── archived/
    └── attachments/
        ├── pf_01K7A.png
        └── pf_01K7B.png
```

Las carpetas bajo `comments/` son colecciones. `inbox`, `resolved` y `archived` existen por defecto. El usuario puede crear otras, como `mobile`, `checkout` o `release-2`.

### 6.2 Configuración del proyecto

Ejemplo de `.perfect-front/project.json`:

```json
{
  "version": 1,
  "name": "Mi proyecto",
  "command": "pnpm dev",
  "url": "http://localhost:5173",
  "defaultCollection": "inbox",
  "resolvedCollection": "resolved",
  "captureScreenshots": true,
  "openBrowser": true
}
```

Todos los campos, excepto `version`, pueden ser creados automáticamente. La configuración explícita tiene prioridad sobre la detección.

### 6.3 Esquema de comentario

Ejemplo de `.perfect-front/comments/inbox/pf_01K7A.json`:

```json
{
  "version": 1,
  "id": "pf_01K7A",
  "status": "pending",
  "collection": "inbox",
  "scope": "element",
  "comment": "Este botón debe ocupar todo el ancho en móvil.",
  "project": {
    "name": "Mi proyecto",
    "relativeRoot": "."
  },
  "location": {
    "url": "http://localhost:5173/pricing",
    "route": "/pricing",
    "title": "Precios",
    "selector": "main > section.pricing button.buy",
    "selectorCandidates": [
      "[data-testid=\"buy-button\"]",
      "main > section.pricing button.buy"
    ],
    "text": "Comprar",
    "html": "<button class=\"buy\">Comprar</button>",
    "componentHint": null
  },
  "viewport": {
    "width": 390,
    "height": 844,
    "devicePixelRatio": 2,
    "scrollX": 0,
    "scrollY": 726
  },
  "elementRect": {
    "x": 20,
    "y": 601,
    "width": 350,
    "height": 44
  },
  "environment": {
    "framework": "vite-react",
    "browser": "Chrome",
    "colorScheme": "dark"
  },
  "attachments": [
    "attachments/pf_01K7A.png"
  ],
  "createdAt": "2026-10-03T15:30:00.000Z",
  "updatedAt": "2026-10-03T15:30:00.000Z",
  "resolution": null
}
```

### 6.4 Comentario de vista completa

Cuando `scope` sea `view`, `selector`, `html` y `elementRect` pueden ser nulos. La ruta, el viewport, la captura y el comentario siguen siendo obligatorios según la configuración.

### 6.5 Resolución

Ejemplo del bloque `resolution`:

```json
{
  "resolvedAt": "2026-10-03T17:10:00.000Z",
  "resolvedBy": "codex",
  "summary": "Se aplicó ancho completo al botón en el breakpoint móvil.",
  "filesChanged": [
    "src/components/BuyButton.tsx"
  ],
  "verification": [
    "pnpm test",
    "verificación visual a 390x844"
  ],
  "commit": null
}
```

### 6.6 Operaciones atómicas

Para evitar archivos parciales:

1. escribir en un archivo temporal dentro de `.perfect-front/`;
2. validar el JSON resultante;
3. renombrar el archivo temporal sobre el destino;
4. emitir el evento de actualización después del rename.

## 7. Movimiento y organización

Mover un comentario significa mover físicamente su JSON entre colecciones.

```text
Antes:
.perfect-front/comments/inbox/pf_01K7A.json

Después:
.perfect-front/comments/mobile/pf_01K7A.json
```

Durante la operación:

1. se conserva el ID;
2. se actualizan `collection` y `updatedAt`;
3. los adjuntos no se duplican;
4. no quedan dos copias del comentario;
5. el dashboard recibe un evento de movimiento.

El dashboard debe permitir movimiento individual y por lote.

Comandos previstos:

```bash
comment list
comment move pf_01K7A --to mobile
comment move pf_01K7A pf_01K7B --to resolved
comment collection create checkout
comment collection list
```

## 8. Markdown y exportaciones

JSON es la única fuente de verdad. Markdown no se mantiene en paralelo porque produciría duplicación y desincronización.

Se podrá generar un reporte cuando se necesite:

```bash
comment export --format md
comment export --format md --collection inbox
comment export --format json
```

Ejemplo de salida:

```text
.perfect-front/exports/comments-2026-10-03.md
```

Editar el reporte no debe alterar los comentarios originales. Una futura función de importación deberá ser explícita y validar IDs.

## 9. Detección de proyectos

### 9.1 Prioridad

1. `.perfect-front/project.json`.
2. Campo `packageManager` de `package.json`.
3. Lockfiles.
4. Archivos característicos del framework.
5. Scripts de `package.json`.
6. Configuración interactiva como último recurso.

### 9.2 Vite

Indicadores:

- dependencia `vite`;
- `vite.config.ts`, `.js`, `.mts` o `.mjs`;
- script `dev` que ejecuta Vite.

Comando típico:

```bash
pnpm dev
```

Perfect Front no debe modificar `vite.config.*`, `main.*` ni el árbol de componentes.

### 9.3 Next.js

Indicadores:

- dependencia `next`;
- `next.config.*`;
- script `dev` que ejecuta `next dev`.

### 9.4 Angular

Indicadores:

- `angular.json`;
- dependencia `@angular/core`;
- script que ejecuta `ng serve`.

### 9.5 HTML estático

Si existe `index.html` y no se identifica un framework ejecutable, Perfect Front levanta un servidor estático propio. No debe alterar los archivos HTML.

**Reglas de selección:**

- `index.html` siempre será la página servida si existe.
- Si no existe `index.html` y hay múltiples archivos HTML en la raíz, Perfect Front:
  - mostrará un selector interactivo al usuario (`--page`, `--choose`);
  - recordará la selección en `.perfect-front/project.json` solo con confirmación explícita del usuario.

### 9.6 Servidor existente

Si el servidor ya está levantado:

- no debe iniciarse otro proceso;
- debe registrarse como proceso externo;
- `comment stop` no debe terminar procesos externos salvo una opción explícita;
- el usuario puede proporcionar la URL:

```bash
comment --url http://localhost:4000
```

## 10. Descubrimiento de servidores

La extensión no es la fuente de verdad de los procesos locales.

El servidor local conoce con certeza:

- procesos iniciados por Perfect Front;
- URL declarada por configuración;
- puertos confirmados durante el inicio;
- proyectos registrados en la sesión.

La extensión descubre servidores locales de Perfect Front automáticamente:

- escanea puertos 45800–45820;
- consulta `GET /api/health` en cada puerto;
- obtiene la lista de proyectos con `GET /api/projects` en servidores vivos;
- al tocar un proyecto en el popup, abre su URL en una nueva pestaña (enfocando la existente si ya está abierta).

No hay emparejamiento por código ni asociación interactiva. El servidor identifica la extensión únicamente por su origen (`chrome-extension://<EXTENSION_ID>`), que el navegador impone y una página web no puede falsificar.

## 11. CLI previsto

```bash
comment
comment open
comment status
comment start
comment stop
comment restart
comment logs
comment list
comment show <id>
comment move <id...> --to <collection>
comment edit <id>
comment resolve <id>
comment ignore <id>
comment reopen <id>
comment collection create <name>
comment collection list
comment export --format md
comment --url <url>
comment --no-start
comment --no-open
```

### 11.1 `comment`

Comando principal. Equivale a detectar, registrar, iniciar o conectar, y abrir.

### 11.1.1 Modo de ejecución

El proceso `perfect-front` se ejecuta en **primer plano**. Ctrl+C apaga completamente:

- todos los servidores iniciados por Perfect Front;
- el dashboard;
- el propio servidor local;
- los procesos de desarrollo del proyecto (si fueron iniciados por Perfect Front).

El usuario debe confirmar explícitamente si hay comentarios pendientes no guardados.

### 11.2 `comment resolve`

Sin ID, puede abrir una selección interactiva de pendientes. Con ID, marca el comentario como resuelto después de solicitar o recibir los datos de resolución necesarios.

Para integración con agentes, deberá existir una salida legible por máquina:

```bash
comment list --status pending --json
comment show pf_01K7A --json
comment resolve pf_01K7A --summary "..." --file src/App.tsx
```

## 12. API local inicial

Base sugerida:

```text
http://127.0.0.1:45800
```

Rutas conceptuales:

```text
GET    /api/health
GET    /api/projects
POST   /api/projects/register
POST   /api/projects/:id/start
POST   /api/projects/:id/stop
GET    /api/projects/:id/logs
GET    /api/projects/:id/comments
POST   /api/projects/:id/comments
GET    /api/projects/:id/comments/:commentId
PATCH  /api/projects/:id/comments/:commentId
POST   /api/projects/:id/comments/:commentId/move
POST   /api/projects/:id/comments/:commentId/resolve
GET    /api/projects/:id/collections
POST   /api/projects/:id/collections
GET    /api/events
```

La API no debe aceptar rutas absolutas enviadas por el overlay. Debe recibir un `projectId` y resolver internamente la raíz registrada.

## 13. Extensión de Chrome

### 13.1 Manifest V3

Permisos mínimos previstos:

- `activeTab`;
- `scripting`;
- `storage`;
- permisos opcionales para hosts locales cuando sean necesarios.

No se debe pedir acceso global a todos los sitios si el flujo puede funcionar mediante autorización temporal de la pestaña activa.

### 13.2 Estados

```text
OFF        vista normal
SELECTING  inspección visual activa
EDITING    formulario de comentario abierto
SAVING     envío al servidor local
SAVED      confirmación breve
ERROR      error recuperable
```

### 13.3 Aislamiento

La UI del overlay debe vivir en un Shadow Root. Sus estilos no deben depender del CSS del sitio. Debe usar una capa superior controlada y evitar bloquear la aplicación cuando el modo esté apagado.

### 13.4 Atajos iniciales

Los atajos serán configurables. Propuesta inicial:

```text
Alt + C       activar o desactivar comentarios
Escape        cancelar selección o cerrar formulario
Enter         guardar cuando el formulario está activo
```

Los atajos no deben ejecutarse mientras el usuario escribe, salvo Escape y las combinaciones explícitas.

### 13.5 Capa de comentarios por defecto

La capa de comentarios está **activa por defecto** en las páginas de proyectos registrados. El popup dispone de un switch global para encenderla o apagarla (preferencia persistente en `storage.local`). Al apagarla:

- el overlay se oculta completamente;
- los atajos no se ejecutan;
- permite interactuar con la página normalmente sin interferencias.

La activación/desactivación es instantánea mediante mensajes entre content script y service worker.

### 13.6 Selección y localización futura

El MVP será agnóstico al framework y utilizará DOM. Debe conservar múltiples pistas:

- atributos `data-testid`, `id` y ARIA;
- selector CSS estructural;
- texto normalizado;
- tag name;
- fragmento HTML;
- ruta;
- geometría aproximada;
- captura.

En fases posteriores se podrán incorporar adaptadores para localizar el archivo fuente en React, Angular u otros frameworks. Esa capacidad no es requisito del primer MVP.

## 14. Dashboard

### 14.1 Organización visual

```text
┌ Proyectos ──────┬ Comentarios ───────────────┬ Detalle ─────────────┐
│ ContentOEP   7  │ Inicio                 3   │ Reducir espacio      │
│ ACME          2 │ Planes                 4   │                      │
│ Portfolio     0 │ Login                  2   │ captura y contexto   │
│                 │                           │ estado y acciones     │
└─────────────────┴───────────────────────────┴───────────────────────┘
```

El preview o contexto del comentario debe ser protagonista. Los paneles laterales podrán plegarse. La interfaz no debe convertirse en una cuadrícula genérica de tarjetas.

### 14.2 Capacidades mínimas

- selección de proyecto;
- estado del servidor;
- enlace para abrir la aplicación;
- selector de colección;
- búsqueda por texto, ruta e ID;
- filtros por estado;
- editor de comentario;
- movimiento entre colecciones;
- resolución y reapertura;
- captura de pantalla;
- visualización segura del HTML como texto;
- actualización en tiempo real.

## 15. Seguridad

Perfect Front puede escribir en repositorios y ejecutar comandos, por lo que debe tratarse como herramienta local privilegiada.

Reglas mínimas:

1. Escuchar por defecto únicamente en `127.0.0.1`.
2. No aceptar conexiones desde la LAN salvo configuración explícita.
3. Reconocer la extensión oficial por su ID fijo (`Origin: chrome-extension://<EXTENSION_ID>`), impuesto por el navegador. Sin token para ese rol; solo puede consultar health, listar proyectos, comentarios y eventos.
4. Emitir un token de sesión local al iniciar para CLI y dashboard; requerido para registrar proyectos, controlar procesos y funciones administrativas. Cualquier otro origen de extensión recibe 403.
5. Validar `Origin` y `Host`.
6. No recibir rutas de filesystem arbitrarias desde páginas observadas.
7. Resolver todos los destinos debajo de la raíz registrada.
8. Rechazar traversals como `../` y enlaces que escapen de la raíz.
9. Sanitizar HTML y mostrarlo como código, nunca ejecutarlo.
10. Limitar tamaños de comentarios, HTML y capturas.
11. No ejecutar scripts enviados por una página o un comentario.
12. Diferenciar procesos iniciados por Perfect Front de procesos externos.

Los mensajes provenientes de content scripts deben considerarse no confiables y validarse de nuevo en el servidor local.

### 15.1 Modelo de confianza

No hay emparejamiento por código. El servidor reconoce a la extensión oficial únicamente por su ID fijo (`OFFICIAL_EXTENSION_ID` en `packages/shared/src/messages.ts`). El origen `chrome-extension://<ID>` es impuesto por el navegador y una página web no puede falsificarlo.

**Riesgo residual aceptado:** Un proceso local ejecutado por el mismo usuario (no navegador) podría forjar el header `Origin` para acceder a endpoints de solo lectura (health, listar proyectos, comentarios, eventos). Este proceso ya posee los privilegios del usuario sobre los archivos del proyecto, por lo que el riesgo adicional es mínimo. Endpoints administrativos (registrar, controlar procesos) requieren token de sesión.

**IDs de desarrollo:** Solo por configuración explícita en `PF_EXTENSION_IDS` (variable de entorno o archivo `.perfect-front/config.json`). No se detectan automáticamente.

## 16. Manejo de procesos

Cada proceso administrado debe registrar:

- ID del proyecto;
- PID;
- comando y argumentos separados;
- directorio de trabajo;
- hora de inicio;
- URL confirmada;
- puerto;
- estado;
- últimas líneas de salida;
- si fue iniciado por Perfect Front.

El servidor debe terminar solo los procesos que inició, salvo confirmación explícita para un proceso externo.

Al cerrar Perfect Front se definirá una política configurable:

- mantener servidores activos;
- detener los servidores iniciados por Perfect Front;
- preguntar desde el dashboard.

## 17. Compatibilidad y límites iniciales

### Incluido en el MVP

- Windows como plataforma primaria;
- Chrome o navegadores Chromium compatibles;
- proyectos Vite;
- Next.js;
- Angular;
- HTML estático;
- servidores locales HTTP;
- comentarios de elemento y vista;
- JSON individual por comentario;
- colecciones físicas;
- dashboard local;
- exportación Markdown.

### Fuera del MVP

- edición automática de clases o contenido;
- modificación directa del código desde el overlay;
- React Fiber y resolución precisa de componentes;
- source maps avanzados;
- sincronización en la nube;
- colaboración multiusuario;
- autenticación remota;
- publicación obligatoria en Chrome Web Store;
- soporte garantizado para iframes cross-origin;
- aplicaciones remotas que no tengan una carpeta local asociada.

## 18. Estructura futura del repositorio

El repositorio está inicialmente vacío salvo esta especificación. Al implementar, la estructura propuesta es:

```text
perfect-front/
├── apps/
│   ├── dashboard/
│   └── extension/
├── packages/
│   ├── cli/
│   ├── local-server/
│   ├── overlay/
│   ├── project-detector/
│   ├── comment-storage/
│   └── shared/
├── SPEC.md
└── package.json
```

Una alternativa válida es iniciar con menos paquetes y separar responsabilidades cuando el código lo justifique. La arquitectura lógica es obligatoria; la fragmentación física exacta puede evolucionar.

## 19. Fases de implementación

### Fase 1 — Núcleo local

- CLI `comment`;
- detección de raíz;
- detección de Vite;
- servidor local;
- registro de proyecto;
- almacenamiento de un JSON por comentario;
- endpoints de comentarios;
- dashboard mínimo de lectura.

### Fase 2 — Extensión y overlay

- extensión Manifest V3 cargable como unpacked;
- activación por pestaña;
- overlay con Shadow DOM;
- selección de elemento;
- creación de comentario;
- captura opcional;
- actualización en tiempo real.

### Fase 3 — Gestión completa

- edición;
- colecciones;
- movimiento individual y por lote;
- resolución, reapertura e ignorado;
- búsqueda y filtros;
- exportación Markdown;
- navegación desde comentario hasta la ruta.

### Fase 4 — Más tipos de proyecto

- Next.js;
- Angular;
- HTML estático;
- servidores existentes y configuración manual;
- detección mejorada de URL y puerto.

### Fase 5 — Integración con agentes

- salida CLI JSON;
- comandos no interactivos;
- contrato para tomar y resolver comentarios;
- registro de archivos modificados y verificaciones;
- adaptadores opcionales para localizar archivos fuente.

## 20. Criterios de aceptación del primer MVP

El MVP se considera funcional cuando:

1. En un proyecto Vite nuevo, ejecutar `comment` inicia o detecta Vite.
2. Se abre la aplicación en Chrome.
3. La extensión puede activar y desactivar el overlay.
4. Se puede seleccionar un elemento y escribir un comentario.
5. Se crea exactamente un archivo JSON válido en `comments/inbox/`.
6. El dashboard muestra el comentario sin recargar manualmente.
7. El comentario puede editarse.
8. Puede moverse a otra colección sin duplicarse.
9. Puede marcarse como resuelto y conservar datos de resolución.
10. Reiniciar Perfect Front no pierde proyectos configurados ni comentarios.
11. La aplicación Vite no requiere cambios de código o configuración.
12. Perfect Front no escribe fuera de `.perfect-front/` salvo acciones futuras explícitamente autorizadas.

## 21. Decisiones confirmadas

### Arquitectura y producto

- El producto funciona en el navegador, no en Electron.
- Existe una extensión de Chrome para alternar la capa de comentarios.
- Existe un servidor Node.js local para procesos y filesystem.
- Existe un dashboard web local en un puerto estable.
- El comando principal se llama `comment`.
- `comment` se ejecuta desde la raíz del proyecto.
- Vite es una compatibilidad prioritaria.
- No se modifica la aplicación observada para instalar el overlay.
- Los comentarios viven dentro del proyecto observado.
- JSON es la fuente de verdad.
- Cada comentario vive en un archivo JSON separado.
- Las colecciones son carpetas físicas.
- Mover un comentario mueve su archivo, sin copiarlo.
- Markdown es una exportación opcional, no almacenamiento paralelo.
- La primera versión comenta; no edita automáticamente el código visual.

### Decisiones técnicas confirmadas durante implementación

| Decisión | Elección | Motivo |
|---|---|---|
| Servidor HTTP | Hono + @hono/node-server | Ligero, Web Standards, proceso local Node. |
| Bundler (extensión MV3 y dashboard) | Vite | Mismo bundler para toda la toolchain. |
| Canal de eventos | Server-Sent Events (SSE) | Simplicidad unidireccional, sin necesidad bidireccional identificada. |
| Validación de esquemas | Zod 4 con tipos inferidos | Sintaxis declarativa, inferencia de tipos en packages/shared. |
| Testing unitario e integración | Vitest | Ecosistema moderno, soporte TypeScript. |
| Testing E2E | Playwright | Pendiente de implementación (fase 7). |
| Orquestación de monorepo | pnpm recursivo | Sin Turbo por ahora; escalable cuando sea necesario. |
| Linter | ESLint flat config + typescript-eslint | TypeScript 6.x (v7 no es soportada aún por typescript-eslint). |
| Estilos de UI | packages/design-tokens | Fuente única: tokens CSS (--pf-*), clases utilitarias (.pf-*), aislamiento Shadow DOM en overlay. |
| CLI en desarrollo | node --import tsx | Hasta que exista build optimizado (fase 11). |
| Autenticación de extensión | ID fijo + Origin, sin token | Navegador impone `Origin: chrome-extension://<ID>` no falsificable por web; rol extensión sin privilegios administrativos. |
| Descubrimiento de servidores | Escaneo puertos 45800–45820, GET /api/health | Sin emparejamiento por código; automático, descentralizado. |
| Capa de comentarios | Activa por defecto, switch global persistente | Mejora UX en páginas registradas; usuario elige desactivar. |
| HTML estático | index.html prioritario; selector si múltiples | Determinismo sin configuración manual cuando existe index.html. |
| Modo de ejecución | Primer plano, Ctrl+C apaga todo | Simplicidad operacional; sin demonización inicial. |

## 22. Decisiones pendientes para la implementación

Estas decisiones no bloquean la especificación conceptual, pero deben cerrarse antes o durante el scaffold:

1. Nombre publicable del paquete npm y disponibilidad del binario `comment`.
2. Puerto fijo definitivo o estrategia de fallback si `45800` está ocupado.
3. ✓ **Resuelto:** Uso de Server-Sent Events (SSE) como canal de eventos.
4. ✓ **Resuelto:** Framework exacto del dashboard: React + Vite.
5. ✓ **Resuelto:** Herramienta de build de la extensión: Vite.
6. Política predeterminada de `.gitignore` para `.perfect-front/`.
7. Si las capturas se habilitan por defecto.
8. Estrategia de identificación estable de proyectos entre sesiones.
9. Comportamiento cuando una colección se renombra mientras el dashboard está abierto.
10. Forma de distribución inicial de la extensión: unpacked, paquete ZIP o Chrome Web Store.

## 23. Visión posterior

Después del MVP, Perfect Front puede convertirse en una capa común de comunicación entre la interfaz renderizada y herramientas de desarrollo. Adaptadores opcionales podrían localizar componentes y archivos fuente, abrir el editor en una línea concreta o entregar comentarios estructurados a agentes. Estas capacidades deben construirse sobre el formato estable de comentarios, sin reemplazarlo ni acoplar el núcleo a un framework específico.
