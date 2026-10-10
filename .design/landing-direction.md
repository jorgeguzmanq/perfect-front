# Landing Perfect Front: dirección creativa

Constructor: implementa todo en `docs/index.html` (un solo archivo, HTML+CSS+JS vanilla, sin dependencias). Las decisiones ya están tomadas; no hay opciones abiertas.

## 1. Concepto y tono

**Idea central: la landing tiene la capa puesta.** Mientras lees, la página se puede comentar. Lo que ves lo pruebas en el mismo momento, sobre la misma página, y cada comentario termina como un JSON real con el selector real del elemento.

Motivo visual: el **resaltado de selección** de la capa (borde accent de 2px, relleno al 14% y etiqueta mono encima con el selector). Se repite como firma en toda la página: titulares con su etiqueta `h1.hero`, tarjetas "inspeccionadas" y cursores.

Tono: imperativo, técnico y seco, con algo de picardía. Frases de 2 a 6 palabras, nada de "potencia tu flujo" y ningún emoji. Tutea. Muestra código en lugar de describirlo.

## 2. Copy exacto

- **Barra superior:** `Perfect Front` · enlaces `Demo` `Agentes` `GitHub` · conmutador `Claro / Oscuro / Auto`.
- **S1 Hero:** H1 «Señala. Dilo. **Ya está en tu repo.**» · Sub «Alt+clic sobre tu app en desarrollo, escribe qué cambiar y el comentario queda como JSON en `.perfect-front/`. Para ti o para tu agente.» · CTA primario «Ver en GitHub» · CTA secundario «Probar la capa v2 →» (`overlay-layer-v2.html`) · Chip flotante «Psst: esta página también. <kbd>Alt</kbd>+clic donde quieras.» (en móvil: «Psst: toca ✎ y luego cualquier cosa.»).
- **S2 Tu turno:** eyebrow `01 · apuntar` · H2 «Tu turno.» · Sub «Alt+clic en cualquier cosa de esta app. ↑↓←→ para moverte por el DOM.» · Placeholder del panel «¿Qué debería cambiar?» · Toast «Guardado en `inbox/pf_7Q2X.json`» + «Deshacer».
- **S3 Tres verbos:** eyebrow `02 · describir` · H2 «Más que una nota.» · Paso A «**Apuntar.** Uno o varios. Numerados, en orden.» · Paso B «**Describir.** Texto, capturas y estilos antes → después.» · Paso C «**Organizar.** Grupos, cola y cajón. Nada se pierde.» · Microcopy del dropzone «Suelta la captura aquí» / «o pégala con <kbd>Ctrl</kbd>+<kbd>V</kbd>».
- **S4 Agente:** eyebrow `03 · resolver` · H2 «Lo lee tu agente.» · Sub «CLI con `--json` estable, bloqueo optimista y códigos de salida. Sin servidor ni navegador.» · Pie «Pega el bloque de `AGENTS.md` en tu `CLAUDE.md` y listo.»
- **S5 Cierre:** H2 «Sin tocar tu app.» · Sub «Un proxy local inyecta la capa. Cero imports, cero cuentas, cero nube.» · Línea de frameworks «Vite · Next.js · Angular · HTML estático» · Bloque de instalación con botón «Copiar» (`git clone … && pnpm install && pnpm build`, y después `perfect-front`) · CTA «Ver en GitHub» · Pie «Open source · En desarrollo activo · Hecho por @jorgeguzmanq».

## 3. Estructura de scroll (5 pantallas)

1. **Hero (100svh).** Texto a la izquierda y, a la derecha, la ventana de una app falsa, "Brisa", en su página de precios. Un cursor fantasma reproduce el ciclo en bucle (ver 4.B): Alt+clic en «Comprar», se abre el panel, se escribe solo, Ctrl+Enter, y el JSON sale volando a un árbol de archivos bajo la ventana. El usuario no hace nada; solo mira.
2. **Tu turno (100svh mín.).** La misma app falsa, a tamaño grande y ahora en manos del visitante. A la derecha (debajo en móvil) hay un visor JSON vacío con el texto «// esperando tu primer Alt+clic». El visitante selecciona, escribe y guarda, y ve nacer el JSON con sus datos y el archivo en el árbol.
3. **Tres verbos (sticky, 300vh de recorrido).** El escenario queda fijo y el scroll avanza los pasos A, B y C. El panel v2 cambia de pestaña en cada paso. En B, el visitante arrastra una captura (4.C) y mueve el slider antes→después (4.D).
4. **Agente.** Una terminal a la izquierda y la app falsa a la derecha. Al entrar en vista, la terminal escribe `list` → `claim` → `resolve`; el chip de estado pasa de `pending` a `in_progress` y luego a `resolved`, y el botón «Comprar» de la app se transforma (ocupa el ancho completo). El ciclo queda cerrado.
5. **Cierre.** Diagrama SVG animado del proxy, el comando de instalación y el CTA. Por defecto el lanzador de la capa global se queda visible abajo a la derecha con el contador.

## 4. Interacciones estrella

**A. Capa global sobre la propia landing** (lo que la hace "no template")
- `keydown`/`keyup` de Alt (`e.altKey`) activan `body.pf-armed`. En `pointermove`, `document.elementFromPoint` busca el elemento y mueve **un solo** `div.hl` en posición `fixed` hasta su `getBoundingClientRect()`, con transición `transform,width,height 120ms cubic-bezier(.2,.8,.2,1)`. La etiqueta superior muestra el selector corto calculado (`tag.clase:nth-of-type`, máximo 3 niveles).
- Alt+`click` llama a `preventDefault()` y abre el **mini panel** (clon reducido del panel v2: cabecera con chip de tipo `BTN`/`H1`/`P`, selector, textarea y Guardar), anclado con lógica de flip arriba o abajo según el espacio. Ctrl/Cmd+Enter guarda y Esc cierra.
- Al guardar: toast y +1 en el **lanzador** (`.ln-group` del prototipo, abajo a la derecha, con badge). Abrir el lanzador muestra el cajón con los comentarios como JSON y el botón «Copiar todo». Todo queda en memoria, más `sessionStorage` envuelto en try/catch.
- Teclado: Ctrl/Cmd+Shift+C entra en modo selección sin ratón, Tab o las flechas recorren los elementos y Enter abre el panel. Móvil: el botón ✎ del lanzador alterna el modo y el siguiente `click` selecciona.
- Excluir de la selección la propia capa (`[data-pf-ui]`) y `html`/`body`.

**B. Nacimiento del JSON** (hero en bucle y S2 en vivo)
- Al guardar, el panel hace FLIP hacia un chip de archivo: se mide el rect inicial y el final, y con WAAPI se anima `transform` a escala 0.2 y `border-radius` de 12 a 99px en 520ms con `cubic-bezier(.2,.8,.2,1)`.
- El chip viaja en arco hasta el árbol `.perfect-front/comments/inbox/` mediante WAAPI con 3 keyframes (`offset: .5` levantado −60px). Al llegar, el nodo del árbol entra con `@keyframes pop` (escala .6→1.08→1, 360ms) y un flash de fondo accent 14%→0 en 900ms.
- El visor JSON escribe línea a línea (stagger de 22ms, `opacity` + `translateY(4px)`) con resaltado de sintaxis mediante spans propios: claves en accent, strings en color resolved y números en pending. Campos: `id`, `status`, `comment` (el texto del visitante), `location.route`, `location.selector` (real), `location.text`, `viewport` (real: `innerWidth`/`innerHeight`/`devicePixelRatio`), `environment.colorScheme` (real) y `createdAt` (real).
- Cursor fantasma del hero: un SVG de cursor que se mueve con WAAPI por puntos calculados a partir de los rects reales. Ciclo de unos 7s, pausa de 2.5s y repetición. Se detiene con `visibilitychange`, cuando el hero sale de vista (IntersectionObserver) o cuando el usuario mueve el ratón dentro de la ventana falsa.

**C. Arrastrar capturas** (S3, paso B)
- Tres "polaroids" (mini capturas en HTML/CSS de la app Brisa, con `transform: rotate(-4deg / 3deg / -1deg)`) junto al panel. El arrastre usa Pointer Events (`pointerdown` + `setPointerCapture`, `pointermove`, `pointerup`) y `touch-action: none` en las polaroids.
- Inclinación según la velocidad: `rotate = clamp(vx * 0.6, -12, 12)deg`, suavizado con lerp 0.25 por frame dentro de `requestAnimationFrame`. Mientras se arrastra: `scale(1.06)` y `--pf-shadow-lg`.
- Al entrar en `.dz`, la zona toma la clase `.over` (estado del prototipo). Al soltar dentro, la polaroid hace FLIP hasta su hueco en `.thumbs`, la barra `.bar2` se llena de 0 a 100% en 700ms con ease-out y aparece la ruta `attachments/pf_7Q2X-1.png` en `.dest`. Si se suelta fuera, vuelve con un efecto muelle (`cubic-bezier(.34,1.56,.64,1)`, 420ms).
- Las miniaturas ya soltadas se reordenan arrastrándolas (el índice `.k` 1, 2, 3 se renumera). Alternativa accesible: botón «Adjuntar captura» y, en cada miniatura, los botones ←/→ «Mover».
- Extra real: `paste` en el panel con una imagen del portapapeles crea una miniatura con `URL.createObjectURL`.

**D. Antes → después de estilos** (S3, paso B, y S4)
- Fila `.sr2.chg` del panel con `padding-inline: 14px → 24px` y `width: auto → 100%`. Un `input[type=range]` alimenta `--t` (0–1) sobre el botón «Comprar» de la app falsa: `padding` y `width` se interpolan con `calc()` y aparece un contorno fantasma discontinuo (`.ghost`) con el tamaño "antes".
- En S4, el mismo cambio se dispara solo cuando la terminal llega a `resolve` (transición de 600ms con `cubic-bezier(.2,.8,.2,1)`), seguido de un barrido de brillo diagonal único (`linear-gradient` animado, 800ms).

**Pasos sticky de S3:** sección `height: 300vh` con hijo `position: sticky; top: 0; height: 100svh`. El progreso es `(scrollY - top) / (height - innerHeight)` y se lee en un listener `scroll` pasivo con rAF. Umbrales: 0–.33 A, .33–.66 B, .66–1 C. Cada cambio de paso hace crossfade del panel (opacity + `translateY(8px)`, 280ms). En el paso A, los marcadores 1, 2 y 3 aparecen con stagger de 120ms y se trazan líneas SVG `stroke-dasharray` (dashoffset de 200 a 0, 600ms). En el paso C, una llave `.brace` «Checkout» envuelve los tres marcadores y estos bajan al cajón.

## 5. Paleta, tipografía y tokens

- **Base:** copiar literalmente los tokens `--pf-*` y `--cv-*` del prototipo (`overlay-layer-v2.html`, líneas 9–37), incluido el tema oscuro. La landing es el producto.
- **Tema:** `Auto` por defecto con `prefers-color-scheme`, `:root[data-theme=dark|light]` forzado desde el conmutador y preferencia guardada en `localStorage` con try/catch. El `body` lleva fondo explícito `--cv-bg` con la trama de puntos del prototipo (20px).
- **Tokens propios de la landing:** `--lp-display: "Bricolage Grotesque", var(--pf-font-sans)`; `--lp-mono: "JetBrains Mono", var(--pf-font-mono)`; `--lp-glow: color-mix(in srgb, var(--pf-color-accent) 35%, transparent)`; `--lp-ease: cubic-bezier(.2,.8,.2,1)`; `--lp-spring: cubic-bezier(.34,1.56,.64,1)`; `--lp-max: 1200px`; `--lp-gutter: clamp(16px, 4vw, 40px)`.
- **Google Fonts:** `Bricolage Grotesque` (opsz, wght 400..800) y `JetBrains Mono` (400; 600), con `display=swap` y `preconnect`. Cuerpo en system-ui (`--pf-font-sans`).
- **Escala tipográfica:** H1 `clamp(2.6rem, 7vw, 5.6rem)`, peso 800, `letter-spacing: -.035em`, `line-height: .95`; H2 `clamp(2rem, 5vw, 3.6rem)`, peso 750; eyebrow en mono 12px uppercase con `.08em` y color accent; cuerpo 17px/1.55 en `--pf-color-text-muted`.
- **Acento hype:** «Ya está en tu repo.» en color accent con un subrayado SVG dibujado a mano (path con `stroke-dashoffset`, 900ms y 300ms de retraso al cargar). Detrás del mockup del hero, un halo radial `--lp-glow` de 600px con blur, sin animación.

## 6. Mockups a construir en HTML/CSS (sin imágenes externas)

1. **App falsa "Brisa"** (reutilizar `.pg*` del prototipo): barra de ventana con 3 puntos y la URL `localhost:5173/pricing` · nav «Brisa / Producto / Precios / Entrar» · H3 serif «Planes que respiran contigo» · 3 tarjetas (`Básico $0`, `Pro $12`, `Equipo $29`), cada una con descripción corta y `button.buy` «Comprar». En móvil, una sola tarjeta visible y scroll horizontal dentro de la ventana.
2. **Panel v2** (`.panel`, `.p-head`, `.p-tabs`, `.p-body`, `.p-foot`): chip `BTN`, título «button.buy» con `<small>` «Comprar», ruta `main › section.pricing › button.buy`, pestañas Texto / Imágenes `2` / Estilos `•`, textarea, chips «Incluye: selector · ruta · captura · viewport» y botón «Guardar» con `<kbd>Ctrl ↵</kbd>`.
3. **Árbol de archivos:** `.perfect-front/` → `comments/inbox/` (con `pf_01K7A.json` y `pf_01K7B.json` iniciales) → `attachments/`, en mono 13px con guías verticales de 1px.
4. **Visor JSON:** tarjeta con cabecera `inbox/pf_7Q2X.json` y botón «Copiar». La estructura parte del ejemplo de `SPEC.md` (líneas 292–341), recortada a unos 14 campos.
5. **Terminal:** fondo `#0b0d11` fijo en ambos temas y prompt `~/brisa $`. Secuencia: `perfect-front list --json` → array de 2 elementos (resumido) · `perfect-front claim pf_01K7A` → `✓ claimed (in_progress)` · línea gris `// agente edita src/Pricing.tsx` · `perfect-front resolve pf_01K7A` → `✓ resolved`.
6. **Polaroids:** 3 miniaturas de unos 120×84px, cada una con un recorte CSS de Brisa (nav, tarjeta y botón) y un pie mono `captura-1.png`.
7. **Diagrama del proxy** (SVG inline en S5): cajas `dev server :5173` → `proxy` → `navegador`, rama `servidor local` → `.perfect-front/*.json` y un paquete (círculo accent de 6px) que recorre el path con `offset-path` en un bucle de 3s. Con reduced-motion el paquete queda estático en el medio.
8. **Lanzador y toast globales:** `.ln-group` y `.toast` del prototipo.

## 7. Riesgos y mitigaciones

- **Alt en navegadores y SO:** Alt+clic descarga enlaces en Chrome y en Windows Alt solo enfoca la barra de menú. Hay que hacer `preventDefault` en `click` con `altKey` y en `keydown` de Alt dentro de la página, y además ofrecer siempre la alternativa del ✎ del lanzador y Ctrl/Cmd+Shift+C. En macOS Option se comporta igual; el texto dice «Alt/⌥».
- **Móvil (360px):** no hay hover ni Alt, así que todo funciona con el modo ✎ y tap. La sección sticky de 300vh se reemplaza por debajo de 720px por tres bloques apilados que se activan con IntersectionObserver. El panel ocupa el 100% del ancho con 16px de margen lateral. Para el arrastre: `touch-action: none` solo en las polaroids, para no bloquear el scroll. Sin scroll horizontal de página (`overflow-x: clip` en `main`).
- **prefers-reduced-motion:** sin cursor fantasma (el hero muestra el estado final estático: panel abierto y JSON visible), sin vuelos ni arcos (el chip aparece con un fade de 150ms), S3 sin sticky (bloques apilados), terminal con el texto completo de entrada, sin subrayado dibujado y sin paquete del proxy.
- **Accesibilidad:** el toast va en una región `aria-live="polite"`; el panel es `role="dialog"` con `aria-labelledby`, devuelve el foco al elemento de origen y cierra con Esc; la terminal y el JSON llevan `aria-label` y su texto completo para lectores de pantalla (la animación es `aria-hidden` sobre un duplicado). El contraste AA usa los tokens del prototipo. Foco visible con `--pf-focus-ring`. Los botones de icono llevan `aria-label`.
- **Rendimiento:** solo se animan `transform`/`opacity` (salvo el slider D, acotado a un botón). Un único rAF compartido. Todos los bucles se pausan fuera de vista y con `visibilitychange`. Ningún listener de `pointermove` global sin Alt activo. Fuentes con `display=swap` y solo los pesos usados. Objetivo: menos de 60 KB de HTML+CSS+JS sin contar fuentes.
- **Selector "real":** un selector demasiado largo rompe el layout. Se recorta a 3 niveles y 40 caracteres con elipsis en la etiqueta, aunque el JSON lleva el completo.
- **Honestidad del copy:** no prometer `npx` (no está publicado en npm). La instalación es clone + pnpm. Indicar que la capa v2 está «en diseño».
- **Riesgo de saturación:** como máximo un efecto "wow" activo por pantalla. Si algo compite con la lectura del titular, se elimina.
