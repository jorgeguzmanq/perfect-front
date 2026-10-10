# Perfect Front — Plan de implementación

## 1. Propósito de este plan

Este documento convierte `SPEC.md` en una secuencia implementable. Cada fase incluye alcance, tareas, pruebas y una condición de salida. Las fases deben completarse en orden salvo las tareas explícitamente marcadas como paralelizables.

La regla central es mantener una sola fuente de verdad:

```text
un comentario = un archivo JSON
```

El primer objetivo funcional es revisar un proyecto Vite local de principio a fin. Next.js, Angular y HTML estático se incorporan después de validar ese recorrido.

## 2. Estado inicial

El repositorio contiene:

- especificación de producto;
- plan de implementación;
- workspace pnpm;
- configuración TypeScript base;
- límites de aplicaciones y paquetes;
- manifiestos vacíos sin dependencias ni código ejecutable.

No contiene todavía:

- lockfile;
- dependencias instaladas;
- servidor;
- CLI;
- dashboard;
- extensión;
- overlay;
- pruebas.

## 3. Reglas de ejecución

1. No implementar una fase sin cumplir la condición de salida de la anterior.
2. Agregar pruebas junto con cada comportamiento, no al final del proyecto.
3. Validar todos los datos al cruzar procesos: HTTP, mensajes de extensión, archivos y argumentos CLI.
4. Nunca aceptar una ruta absoluta enviada por una página observada.
5. Mantener la lógica de negocio fuera de rutas HTTP y componentes React.
6. Evitar APIs síncronas de filesystem en rutas de ejecución normales.
7. No modificar archivos de los proyectos observados fuera de `.perfect-front/`.
8. No terminar procesos que Perfect Front no haya iniciado.
9. No introducir almacenamiento Markdown paralelo.
10. Actualizar `SPEC.md` cuando una decisión confirmada cambie.

## 4. Hitos

```text
M0  Fundaciones técnicas
M1  Persistencia local confiable
M2  Detección de Vite
M3  CLI y procesos
M4  API local
M5  Dashboard mínimo
M6  Extensión conectada
M7  Overlay y creación de comentarios
M8  Gestión completa y resolución
M9  Compatibilidad adicional
M10 Robustez, distribución y documentación
```

---

## Fase 0 — Cerrar decisiones y preparar toolchain

### Objetivo

Convertir el scaffold documental en un workspace instalable, reproducible y comprobable.

### Decisiones que deben registrarse

- Framework del dashboard: propuesta inicial, React + Vite.
- Servidor HTTP: comparar Fastify y Hono para un proceso local Node; elegir uno y documentar el motivo.
- Bundler de extensión Manifest V3: evaluar WXT, Plasmo y Vite con plugin específico.
- Canal de eventos: propuesta inicial, Server-Sent Events por simplicidad unidireccional; usar WebSocket solo si aparece una necesidad bidireccional persistente.
- Validación: propuesta inicial, Zod con tipos inferidos.
- CLI parser: seleccionar una librería pequeña que soporte subcomandos, ayuda y errores consistentes.
- Testing: Vitest para unidades/integración y Playwright para navegador.
- Monorepo orchestration: decidir si pnpm recursivo es suficiente antes de agregar Turbo.
- Puerto predeterminado: validar `45800` y definir estrategia de fallback.
- Política de capturas: decidir si son opt-in o predeterminadas.
- Distribución inicial: extensión unpacked durante desarrollo.

### Tareas

- [ ] Confirmar Node.js LTS mínimo y versión de pnpm.
- [ ] Consultar las versiones actuales de dependencias en sus fuentes oficiales.
- [ ] Agregar dependencias raíz de TypeScript, lint, formato y pruebas.
- [ ] Crear `pnpm-lock.yaml` mediante instalación real.
- [ ] Agregar scripts raíz: `dev`, `build`, `typecheck`, `lint`, `test` y `test:e2e`.
- [ ] Crear configuración ESLint de tipo flat config.
- [ ] Crear configuración de formato.
- [ ] Decidir build orchestration y, solo entonces, agregar su configuración.
- [ ] Agregar archivo de versión de Node si se adopta una herramienta concreta.
- [ ] Crear `CONTRIBUTING.md` con comandos y reglas básicas.
- [ ] Inicializar Git si el usuario lo desea; no publicar ni configurar remoto automáticamente.

### Pruebas

- [ ] Una instalación limpia termina sin warnings críticos.
- [ ] Todos los scripts raíz existen y fallan claramente si un paquete aún no está implementado.
- [ ] `typecheck`, `lint` y `test` pueden ejecutarse desde la raíz.

### Condición de salida

Otro desarrollador puede clonar el repositorio, instalar dependencias y ejecutar la suite base con un único gestor de paquetes.

---

## Fase 1 — Contratos compartidos

### Objetivo

Definir los formatos que conectan extensión, servidor, almacenamiento, dashboard y CLI antes de escribir adaptadores.

### Tareas

- [ ] Crear `packages/shared/src`.
- [ ] Definir `ProjectId`, `CommentId`, `CollectionName` y tipos de timestamp.
- [ ] Crear esquema versionado de `ProjectConfig`.
- [ ] Crear esquema versionado de `VisualComment`.
- [ ] Definir `pending`, `in_progress`, `resolved`, `ignored` y `archived`.
- [ ] Definir scopes `element` y `view`.
- [ ] Modelar ubicación, viewport, rectángulo, ambiente, adjuntos y resolución.
- [ ] Definir requests y responses de la API.
- [ ] Definir eventos de proyecto, comentario, colección y proceso.
- [ ] Definir errores serializables con código estable y mensaje seguro.
- [ ] Agregar migrador inicial para `version: 1`, aunque inicialmente sea identidad.
- [ ] Exportar tipos inferidos desde los esquemas, evitando duplicación manual.
- [ ] Documentar compatibilidad hacia atrás de los JSON.

### Pruebas

- [ ] Acepta ejemplos válidos de `SPEC.md`.
- [ ] Rechaza IDs, estados, rutas, URLs y timestamps inválidos.
- [ ] Rechaza propiedades desconocidas en límites de seguridad cuando corresponda.
- [ ] Verifica serialización y deserialización sin pérdida.
- [ ] Verifica errores de migración comprensibles.

### Condición de salida

Todos los procesos pueden importar un único contrato versionado y validar datos desconocidos antes de utilizarlos.

---

## Fase 2 — Almacenamiento de comentarios

### Objetivo

Implementar la fuente de verdad local sin servidor ni interfaz.

### Diseño interno

Separar:

```text
repository  operaciones de archivos
service     reglas de comentarios y colecciones
schemas     validación compartida
```

### Tareas

- [ ] Crear `.perfect-front/` bajo una raíz recibida explícitamente.
- [ ] Crear configuración predeterminada sin sobrescribir una existente.
- [ ] Crear colecciones `inbox`, `resolved` y `archived`.
- [ ] Generar IDs ordenables y seguros como nombre de archivo.
- [ ] Crear comentario en `inbox/`.
- [ ] Leer un comentario por ID sin confiar en la colección proporcionada.
- [ ] Listar comentarios de todas las colecciones.
- [ ] Editar comentario con actualización de `updatedAt`.
- [ ] Mover entre colecciones mediante rename atómico cuando sea posible.
- [ ] Actualizar `collection` dentro del documento durante el movimiento.
- [ ] Resolver, ignorar y reabrir.
- [ ] Evitar duplicados de ID.
- [ ] Guardar adjuntos fuera de las carpetas de comentarios.
- [ ] Implementar escritura temporal + validación + rename.
- [ ] Implementar exportación Markdown de solo lectura.
- [ ] Manejar JSON corrupto sin bloquear el listado completo.
- [ ] Definir si `.perfect-front/` se agrega automáticamente a `.gitignore`; inicialmente solo sugerirlo.

### Seguridad

- [ ] Resolver rutas reales y comprobar que permanecen dentro de la raíz.
- [ ] Rechazar nombres con separadores, `..`, caracteres de control o reservados de Windows.
- [ ] No seguir enlaces simbólicos que permitan escapar de la raíz.
- [ ] Limitar tamaño de comentario, HTML y adjuntos.

### Pruebas

- [ ] Crear, leer, editar, listar y borrar únicamente datos de prueba temporales.
- [ ] Mover conserva ID y deja una sola copia.
- [ ] Resolver registra metadata y mueve a la colección configurada.
- [ ] Dos escrituras simultáneas no producen JSON parcial.
- [ ] Un comentario corrupto se reporta y los demás continúan disponibles.
- [ ] Traversal y symlink escape son rechazados.
- [ ] Funciona con rutas de Windows que contienen espacios.

### Condición de salida

Una suite de integración demuestra el ciclo completo de comentarios usando un directorio temporal, sin depender de HTTP ni Chrome.

---

## Fase 3 — Detección de proyectos y Vite

### Objetivo

Resolver qué proyecto hay en el directorio actual y cómo abrirlo, sin iniciar procesos todavía.

### Tareas

- [ ] Encontrar raíz desde el directorio actual.
- [ ] Dar prioridad a `.perfect-front/project.json`.
- [ ] Leer `package.json` de forma segura.
- [ ] Detectar pnpm, npm, yarn y bun por `packageManager` y lockfiles.
- [ ] Detectar Vite por dependencia, configuración y script.
- [ ] Reconocer React/Vue/Svelte sobre Vite como metadata, sin cambiar el flujo.
- [ ] Elegir script `dev` y construir comando + argumentos sin shell concatenado.
- [ ] Leer puerto declarado cuando sea posible.
- [ ] Permitir overrides `--url`, `--command` y `--port`.
- [ ] Producir explicación de la detección para `comment status`.
- [ ] Definir códigos de error: raíz no encontrada, comando ambiguo y framework desconocido.

### Fixtures

- [ ] Vite + React con pnpm.
- [ ] Vite + Vue con npm.
- [ ] Vite con puerto personalizado.
- [ ] Workspace con aplicación Vite anidada.
- [ ] Proyecto con configuración explícita.
- [ ] Proyecto ambiguo y proyecto no compatible.

### Pruebas

- [ ] La detección es pura: no crea archivos ni procesos.
- [ ] La configuración explícita siempre gana.
- [ ] Los argumentos conservan espacios correctamente.
- [ ] Los fixtures producen resultados deterministas.

### Condición de salida

Dada una raíz Vite, el paquete devuelve un plan validado de ejecución y una URL candidata con explicación trazable.

---

## Fase 4 — CLI y administración de procesos

### Objetivo

Hacer que `comment` pueda iniciar o conectar un proyecto Vite y abrirlo en el navegador.

### Tareas de CLI

- [ ] Publicar el binario local `comment` desde `packages/cli`.
- [ ] Implementar ayuda y versión.
- [ ] Implementar comando principal desde `process.cwd()`.
- [ ] Implementar `status`, `start`, `stop`, `restart`, `logs`, `open` y `--no-open`.
- [ ] Implementar salida humana y `--json`.
- [ ] Utilizar códigos de salida consistentes.
- [ ] Manejar Ctrl+C sin dejar archivos de estado corruptos.

### Tareas de procesos

- [ ] Ejecutar comando y argumentos sin interpolación insegura de shell.
- [ ] Capturar stdout y stderr de manera limitada.
- [ ] Detectar la URL anunciada por Vite.
- [ ] Confirmar disponibilidad mediante HTTP con timeout.
- [ ] Distinguir proceso administrado y servidor externo.
- [ ] Persistir solo metadata necesaria entre reinicios.
- [ ] No matar procesos externos desde `comment stop`.
- [ ] Implementar cierre seguro del árbol de procesos en Windows.
- [ ] Abrir el navegador predeterminado; soportar Chrome explícito después.

### Pruebas

- [ ] Ejecutar un fixture Vite real en un puerto libre.
- [ ] Conectarse si ya está activo.
- [ ] No lanzar un segundo proceso sobre la misma URL.
- [ ] Recuperarse cuando el puerto está ocupado.
- [ ] Detener únicamente el proceso administrado.
- [ ] Mostrar logs útiles cuando Vite falla.

### Condición de salida

Desde un fixture Vite, `comment` abre una URL funcional y `comment stop` deja el sistema en estado limpio.

---

## Fase 5 — Servidor local y API

### Objetivo

Centralizar proyectos, filesystem, procesos y eventos detrás de una API local segura.

### Tareas

- [ ] Crear servidor ligado a `127.0.0.1`, nunca `0.0.0.0` por defecto.
- [ ] Implementar selección de puerto y archivo local de descubrimiento.
- [ ] Generar token de sesión.
- [ ] Crear middleware de autenticación, validación y errores.
- [ ] Validar `Origin` y `Host`.
- [ ] Implementar `/api/health`.
- [ ] Implementar registro y listado de proyectos.
- [ ] Implementar acciones de proceso.
- [ ] Implementar CRUD de comentarios.
- [ ] Implementar colecciones y movimientos.
- [ ] Implementar resolución y reapertura.
- [ ] Implementar streaming de logs limitado.
- [ ] Implementar SSE o el canal elegido en fase 0.
- [ ] Servir posteriormente el build del dashboard.
- [ ] Generar OpenAPI o un contrato equivalente desde los esquemas cuando resulte viable.

### Seguridad

- [ ] Ningún endpoint recibe una raíz absoluta desde el content script.
- [ ] Todo `projectId` se resuelve contra un registro interno.
- [ ] Aplicar límites de body y frecuencia razonables.
- [ ] No devolver stack traces al cliente.
- [ ] Redactar tokens y rutas sensibles de logs compartidos.
- [ ] Probar solicitudes desde orígenes no autorizados.

### Pruebas

- [ ] Integración de todos los endpoints contra directorios temporales.
- [ ] Eventos emitidos después de escrituras confirmadas.
- [ ] Errores HTTP coherentes y validables.
- [ ] Token ausente o inválido produce rechazo.
- [ ] Host no local produce rechazo.
- [ ] Reinicio reconstruye estado sin perder comentarios.

### Condición de salida

La API permite completar todo el ciclo de un comentario sin utilizar directamente el paquete de storage desde el consumidor.

---

## Fase 6 — Extensión Manifest V3 básica

### Objetivo

Conectar una pestaña local con Perfect Front sin overlay todavía.

### Tareas

- [ ] Crear manifest con permisos mínimos.
- [ ] Crear service worker con listeners registrados en nivel superior.
- [ ] Persistir estado en `chrome.storage`, no en variables globales.
- [ ] Crear popup con estado de conexión.
- [ ] Descubrir el servidor local y autenticar la sesión.
- [ ] Consultar si la URL actual pertenece a un proyecto registrado.
- [ ] Mostrar proyecto, URL, servidor y pendientes.
- [ ] Abrir dashboard y aplicación.
- [ ] Agregar acción “Activar comentarios”.
- [ ] Manejar servidor ausente con instrucciones precisas.
- [ ] Solicitar permisos de host de forma gradual.

### Pruebas

- [ ] Unitarias del protocolo de mensajes.
- [ ] Carga unpacked sin errores.
- [ ] Popup reconoce un proyecto registrado.
- [ ] Pestaña no registrada no obtiene acceso de escritura.
- [ ] Reiniciar el service worker conserva el estado necesario.

### Condición de salida

La extensión cargada manualmente identifica correctamente una pestaña Vite registrada y abre su dashboard.

---

## Fase 7 — Overlay y creación de comentarios

### Objetivo

Completar el primer recorrido visible: seleccionar un elemento y crear su JSON.

### Tareas del overlay

- [ ] Montar un host único en la página.
- [ ] Adjuntar Shadow Root cerrado o abierto según necesidades de depuración documentadas.
- [ ] Inyectar estilos aislados.
- [ ] Implementar estados OFF, SELECTING, EDITING, SAVING, SAVED y ERROR.
- [ ] Resaltar elemento bajo el cursor.
- [ ] Excluir el propio overlay de la selección.
- [ ] Prevenir navegación solo durante la selección confirmada.
- [ ] Seleccionar padre e hijo.
- [ ] Capturar ruta, título, texto, tag, HTML limitado, viewport, scroll y rectángulo.
- [ ] Generar varios candidatos de selector priorizando identificadores estables.
- [ ] Crear comentarios de elemento y de vista.
- [ ] Implementar formulario accesible con teclado.
- [ ] Restaurar completamente la página al desactivar.

### Comunicación

- [ ] Content script envía datos al service worker.
- [ ] Service worker valida remitente y forma básica.
- [ ] Servidor vuelve a validar el payload completo.
- [ ] Confirmación incluye ID, colección y ubicación lógica.
- [ ] Los errores no pierden el texto escrito.

### Capturas

- [ ] Evaluar `captureVisibleTab` y sus permisos.
- [ ] Capturar solo con acción explícita o según la política decidida.
- [ ] Marcar visualmente el elemento sin contaminar la captura final, según diseño.
- [ ] Limitar tamaño y formato.

### Pruebas

- [ ] Vite React, Vue y HTML renderizado dentro de Vite.
- [ ] Páginas con Tailwind, CSS Modules y estilos globales agresivos.
- [ ] Scroll, zoom, dark mode y viewport móvil.
- [ ] Elementos anidados, SVG, enlaces, botones y formularios.
- [ ] Activar y desactivar no deja nodos ni listeners residuales.
- [ ] Se crea exactamente un JSON válido por guardado.

### Condición de salida

Un usuario puede ejecutar `comment`, activar la extensión, seleccionar un elemento Vite y ver el comentario recién creado en el filesystem.

---

## Fase 8 — Dashboard y gestión completa

### Objetivo

Administrar proyectos y comentarios sin tocar archivos manualmente.

### Tareas

- [ ] Crear shell del dashboard y cliente API tipado.
- [ ] Implementar lista de proyectos y estado de procesos.
- [ ] Implementar iniciar, detener, reiniciar, abrir y logs.
- [ ] Implementar navegación por colecciones.
- [ ] Implementar lista virtualizada solo si las mediciones lo justifican.
- [ ] Implementar búsqueda por ID, texto y ruta.
- [ ] Implementar filtros por estado.
- [ ] Implementar detalle con captura y HTML escapado.
- [ ] Implementar edición con control de conflictos mediante `updatedAt` o revisión.
- [ ] Implementar movimiento individual y por lote.
- [ ] Implementar crear y renombrar colecciones con validación.
- [ ] Implementar resolver, ignorar, reabrir y archivar.
- [ ] Implementar actualización por eventos.
- [ ] Implementar estados vacíos y errores recuperables.
- [ ] Implementar navegación a la ruta del comentario.
- [ ] Intentar reencontrar el elemento usando candidatos de selector y texto.

### Accesibilidad y diseño

- [ ] Navegación completa por teclado.
- [ ] Foco visible y orden lógico.
- [ ] Etiquetas accesibles y anuncios de cambios.
- [ ] Contraste suficiente.
- [ ] Preferencia de movimiento reducido.
- [ ] Preview/contexto como superficie principal; paneles laterales plegables.
- [ ] Responsive para uso en una ventana estrecha de navegador.

### Pruebas

- [ ] Componentes y estados principales.
- [ ] Integración con API real temporal.
- [ ] Conflicto de edición entre dos pestañas.
- [ ] Movimiento por lote sin duplicados.
- [ ] Recuperación ante JSON corrupto.
- [ ] Navegación y acciones críticas con teclado.

### Condición de salida

Todo el ciclo de comentario puede gestionarse desde el navegador y queda reflejado de manera exacta en los archivos del proyecto.

---

## Fase 9 — Resolución por CLI y agentes

### Objetivo

Permitir procesamiento automatizado sin depender de la interfaz gráfica.

### Tareas

- [ ] Implementar `comment list --json`.
- [ ] Implementar `comment show <id> --json`.
- [ ] Implementar `comment move`.
- [ ] Implementar `comment edit` no interactivo.
- [ ] Implementar `comment resolve` con summary, files, verification y commit opcional.
- [ ] Implementar `comment reopen` e `ignore`.
- [ ] Bloqueo optimista para evitar resolver una versión obsoleta.
- [ ] Documentar el contrato para agentes.
- [ ] Crear una guía de localización por ruta, texto, selectores y HTML.
- [ ] Registrar resultado parcial cuando el elemento no puede localizarse con confianza.
- [ ] No permitir que “resolver” modifique código por sí solo; el agente o desarrollador realiza el cambio y reporta la resolución.

### Pruebas

- [ ] Flujo no interactivo completo con salida JSON.
- [ ] IDs inexistentes y revisiones obsoletas fallan claramente.
- [ ] Resolución conserva historial y adjuntos.
- [ ] Scripts consumidores pueden distinguir éxito, conflicto y validación por código de salida.

### Condición de salida

Un agente puede descubrir un comentario, modificar el proyecto, verificarlo y registrar la resolución usando contratos documentados.

---

## Fase 10 — Otros frameworks y HTML

### Objetivo

Extender el launcher sin cambiar overlay, storage ni formato de comentarios.

### Next.js

- [ ] Detectar configuración y scripts.
- [ ] Reconocer puertos y URL anunciada.
- [ ] Probar App Router y Pages Router.
- [ ] Confirmar que CSP de desarrollo no bloquea la extensión.

### Angular

- [ ] Detectar `angular.json` y proyecto predeterminado.
- [ ] Construir argumentos de `ng serve`.
- [ ] Detectar URL anunciada.
- [ ] Probar navegación del router.

### HTML estático

- [ ] Detectar `index.html` sin runner conocido.
- [ ] Implementar servidor estático seguro con fallback configurable.
- [ ] Proteger contra traversal.
- [ ] Elegir y anunciar puerto libre.

### Servidor manual

- [ ] Guardar comando y URL explícitos.
- [ ] Soportar `comment --url` y `--no-start`.
- [ ] Asociar temporalmente una URL con una raíz.

### Condición de salida

La misma extensión y el mismo dashboard completan el flujo sobre Vite, Next.js, Angular y HTML sin modificaciones dentro de esas aplicaciones.

---

## Fase 11 — Robustez y distribución

### Objetivo

Preparar una versión utilizable fuera del entorno del autor.

### Tareas

- [ ] Auditoría de permisos de extensión.
- [ ] Auditoría de escritura y ejecución local.
- [ ] Pruebas de rutas Windows, macOS y Linux si se declara soporte.
- [ ] Pruebas de recuperación tras cierre inesperado.
- [ ] Rotación y límites de logs.
- [ ] Política de actualización de esquemas.
- [ ] Comprobación de dependencias y licencias.
- [ ] Bundles reproducibles.
- [ ] Instalación del CLI sin privilegios innecesarios.
- [ ] ZIP de extensión para desarrollo y canal de distribución decidido.
- [ ] Guía de instalación, onboarding y troubleshooting.
- [ ] Fixture/demo incorporado al repositorio.
- [ ] Métricas locales opt-in únicamente si se consideran necesarias; ninguna telemetría silenciosa.

### Pruebas end-to-end

- [ ] Instalación limpia.
- [ ] `comment` sobre Vite.
- [ ] Activación de extensión.
- [ ] Creación con captura.
- [ ] Edición y movimiento.
- [ ] Resolución por CLI.
- [ ] Reinicio y recuperación.
- [ ] Desinstalación sin borrar comentarios del proyecto.

### Condición de salida

Existe una versión etiquetada, reproducible, documentada y verificable por una persona que no participó en su desarrollo.

---

## 5. Matriz mínima de pruebas

| Área | Unitarias | Integración | E2E |
|---|---:|---:|---:|
| Esquemas compartidos | Sí | — | — |
| Storage | Sí | Sí | — |
| Detección de proyectos | Sí | Sí | — |
| Procesos | Sí | Sí | Sí |
| API | Sí | Sí | Sí |
| Extensión | Sí | Sí | Sí |
| Overlay | Sí | Sí | Sí |
| Dashboard | Sí | Sí | Sí |
| CLI | Sí | Sí | Sí |

Los tests de filesystem deben usar directorios temporales. Los tests de procesos deben reservar puertos dinámicos. Ninguna prueba puede escribir en un proyecto real del usuario.

## 6. Definición global de terminado

Una funcionalidad solo está terminada cuando:

- [ ] cumple el contrato documentado;
- [ ] valida entradas desconocidas;
- [ ] tiene pruebas proporcionales al riesgo;
- [ ] maneja errores sin perder comentarios;
- [ ] no amplía permisos innecesariamente;
- [ ] funciona desde la raíz del workspace;
- [ ] actualiza documentación si cambia una decisión;
- [ ] no deja procesos, archivos temporales o listeners huérfanos.

## 7. Primer corte recomendado

El primer sprint debe completar fases 0 a 3 y producir una demostración por terminal:

```text
directorio Vite
  → detección correcta
  → creación de .perfect-front/
  → creación de comentario JSON simulado
  → movimiento a otra colección
  → exportación Markdown
```

El segundo sprint debe completar fases 4 a 7 para lograr el recorrido real desde Chrome. El dashboard completo debe construirse después de validar que la captura y persistencia del comentario funcionan de extremo a extremo.
