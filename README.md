<div align="center">

# Perfect Front

**Revisión visual local para proyectos web.**
Abre tu app, toca un elemento, di qué cambiar. Cada comentario queda como un archivo JSON dentro de tu proyecto, listo para que una persona o un agente de código lo procese.

[Sitio](https://jorgeguzmanq.github.io/perfect-front/) · [Prototipo de la capa v2](https://jorgeguzmanq.github.io/perfect-front/overlay-layer-v2.html) · [Especificación](./SPEC.md) · [Plan](./PLAN.md)

</div>

---

## Por qué

El feedback visual suele vivir lejos del código: capturas en un chat, notas sueltas, tickets sin contexto. Perfect Front lo captura **donde ocurre** (en la página renderizada) y lo guarda **donde se usa** (en la carpeta del proyecto).

- **Sin tocar tu app.** No hay imports, plugins ni componentes que agregar al proyecto observado.
- **Cualquier framework.** Vite, Next.js, Angular o HTML estático.
- **El proyecto es dueño de sus comentarios.** Un comentario = un archivo en `.perfect-front/`. Sin nube, sin cuenta, sin base de datos externa.
- **Pensado para agentes.** CLI con salida `--json` estable, bloqueo optimista y códigos de salida documentados.
- **Contexto suficiente para reencontrar el elemento:** selector, archivo y línea, ruta, y captura opcional.

## Cómo funciona

```text
 tu dev server ──► proxy local ──► navegador
                     │  inyecta /__pf/overlay.js
                     ▼
               servidor local ──► <proyecto>/.perfect-front/*.json
                     ▲
        dashboard · CLI · agentes
```

1. `perfect-front` (alias `comment`) detecta el proyecto, inicia o reutiliza su dev server y levanta el servidor local.
2. Un proxy se coloca delante del dev server e inyecta la capa de comentarios en el HTML.
3. Alt+clic sobre un elemento (o <kbd>Ctrl/Cmd</kbd>+<kbd>Mayús</kbd>+<kbd>C</kbd>) abre el editor.
4. El comentario se guarda como JSON en el proyecto. El dashboard y la CLI permiten leerlo, organizarlo y resolverlo.

## Inicio rápido

Requisitos: **Node.js ≥ 22** y **pnpm ≥ 11**.

```bash
git clone https://github.com/jorgeguzmanq/perfect-front.git
cd perfect-front
pnpm install
pnpm build
```

Desde la raíz del proyecto que quieras revisar:

```bash
perfect-front            # o: comment
```

Opciones útiles: `--no-open`, `--no-proxy`, `--server-port <n>`, `--detach`. Subcomandos: `start`, `stop`, `status`, `logs`, `list`, `show`, `claim`, `resolve`, `export`. Detalle en [`packages/cli`](./packages/cli/README.md).

### Flujo en la capa

| Acción | Resultado |
|---|---|
| Alt+clic / <kbd>Ctrl/Cmd+Mayús+C</kbd> | Modo selección |
| ↑ / ↓ | Padre / hijo del elemento |
| <kbd>Ctrl/Cmd+Enter</kbd> | Guardar |
| **Guardar** | Se guarda y queda listo para elegir **otro** elemento, sin pasos extra |
| **Eliminar elemento** | Guarda un comentario «Eliminar este elemento.» (con nota opcional) |
| <kbd>Esc</kbd> | Salir |

## Trabajar con agentes de código

Los comentarios se procesan sin servidor ni navegador:

```bash
perfect-front list --json
perfect-front claim <id>
perfect-front resolve <id>
```

El contrato completo y un bloque para pegar en el `CLAUDE.md` de tu proyecto están en [`packages/cli/AGENTS.md`](./packages/cli/AGENTS.md).

## Estructura

```text
apps/dashboard            Centro web de proyectos y comentarios
apps/extension            Extensión Chrome (Manifest V3)
packages/cli              Binario perfect-front / comment
packages/local-server     API local, eventos y procesos
packages/proxy            Proxy que inyecta la capa
packages/overlay          Capa visual inyectada en las páginas
packages/project-detector Detección de frameworks, comandos y puertos
packages/comment-storage  Persistencia de comentarios y colecciones
packages/shared           Contratos y esquemas compartidos
packages/design-tokens    Tokens y estilos base
```

## Hoja de ruta: capa v2

Un [prototipo interactivo](https://jorgeguzmanq.github.io/perfect-front/overlay-layer-v2.html) define la siguiente versión de la capa. Su regla: **cada zona responde una sola pregunta**, y las funciones aparecen solo cuando tienen sentido.

| Verbo | Pregunta | Funciones |
|---|---|---|
| **Apuntar** | ¿A qué nodos me refiero? | navegación en 4 direcciones, selección múltiple, reordenar hermanos, copiar ubicación |
| **Describir** | ¿Qué debería cambiar? | texto e i18n, **imágenes** (pegar, soltar, abrir), estilos propuestos |
| **Organizar** | ¿Con qué otros se entiende? | grupos, cola de lectura, cajón de comentarios |

Principios: los cambios se **proponen** (antes → después) y nunca modifican el código; todo es previsualizable y reversible; los estilos distinguen entre *editable* y *foundation* según el origen de cada regla.

## Desarrollo

```bash
pnpm dev          # servidores de desarrollo
pnpm typecheck
pnpm lint
pnpm test
```

Más en [`CONTRIBUTING.md`](./CONTRIBUTING.md). Las decisiones de producto y arquitectura viven en [`SPEC.md`](./SPEC.md).

## Estado

En desarrollo activo. El CLI, el servidor local, el proxy, la capa, el dashboard y la extensión funcionan; la capa v2 está en diseño.
