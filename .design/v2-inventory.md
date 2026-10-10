# Inventario v2 de la capa de comentarios

Fuente: `Z:\Dev\perfect-front-overlay-v2\.design\overlay-layer.html` (846 líneas: CSS 8-403, markup 405-547, JS 549-843).

Nota de alcance: el prototipo es estático. El script solo registra listeners en los botones de tema (`:573`) y en `load`/`resize`/cambio de tema para recolocar pines (`:839-840`). Los `data-act` (`tab`, `scope`, `save`, `sty`, `kscope`, `mvup`, etc.) no tienen manejador. No hay `keydown`. Por eso todo lo que sigue describe lo que el markup y las funciones de render muestran, y las transiciones están solo declaradas en texto cuando no hay código que las ejecute.

---

## 1. Estados de la UI y transiciones

### 1.1 Estado del panel (objeto `s`, `base()` en `:604`, `panel()` en `:607`)

| Propiedad | Valores | Efecto en render |
|---|---|---|
| `scope` | `element` / `view` | `view` cambia título, subtítulo, placeholder, oculta copiar, apaga navegador y pestañas Contenido/Estilos/Estructura |
| `nodes.length` | 1 / 2+ (`multi`) | 1: título con `name` y `en comp`; 2+: `N elementos`, bandeja, seg «Aplicar a» |
| `tab` | `comment` / `content` / `styles` / `struct` / `queue` | Cuerpo de la pestaña activa (`:632`) |
| `status` | (implícito idle) / `saving` / `empty` / `server` | Ver 1.3 |
| `dropping` | bool | Zona de imágenes en modo «Suelta para adjuntar» |
| `imgErr` | texto | Mensaje de error de imagen |
| `images` | lista (`up`, `k`, `url`, `bg`) | Miniaturas; `up` muestra barra de progreso |
| `copy` / `copied` | bool / clave (`file`, `sel`, `pf`, `md`, `all`) | Menú «Copiar como»; confirmación «¡Copiado!» en el ítem |
| `addMode` | bool | Botón «Sumar» con `.on` y `aria-pressed` |
| `applyAll` | bool | Seg «Solo el foco» / «Los N elementos» en Estilos |
| `fndOpen` | bool | Colapsa o despliega Foundations |
| `live` | bool | Ruta de adjuntos `c-04` o `c-05` |
| `group` | null / `{id,name,at}` | Pestaña Cola (punto de grupo, cola o estado vacío), botón «Guardar en la cola» |
| `changes` | objeto por propiedad (`from`, `to`) | Filas `.chg`, resumen, badge, chip «Incluye» |
| `moves` | lista (`from`, `to`) | Nota «Propuesta: mover…» y badge de Estructura |
| `content` | null / `fixed` / `i18n` / `dyn` | Pestaña Contenido apagada si es null |
| `lang` | `es` / `en` / `pt` | Idioma activo en Contenido i18n |
| `pos` / `sibs` / `canUp` / `canDown` | índice y lista de hermanos | Deshabilita ←, →, ↑, ↓ según límites |
| `draft` | texto (máx. 10.000) | Textarea, contador, texto de la cola |

### 1.2 Estados de la capa (lanzador, selección, cajón)

Columnas del cuadro «Qué aparece cuándo» (`:444-460`): Reposo, Eligiendo, 1 nodo, Varios, Vista.

- Lanzador (`.ln-main`): reposo muestra «Comentar» con badge de conteo. `.on` muestra «Selecciona…» con `aria-pressed="true"` (`:830`). En todos los estados aparece en modo compacto.
- Barra de selección (`.bar`, `:161`): visible solo en «Eligiendo» según la tabla. En el markup aparece en la sección Selección múltiple (`:766`) con «N elementos» y «Comentar selección».
- Cajón: se abre desde el menú del lanzador (ítem «Comentarios») según `:835`. La tabla dice «desde menú» en Reposo/Eligiendo y «se cierra» en los estados con nodo. El código no implementa ese cierre.

### 1.3 Estados de guardado y error

- `saving`: textarea deshabilitada (`:660`), «Descartar» y botones de imagen deshabilitados, Guardar muestra spinner y «Guardando…» (`:643`), `aria-busy="true"` en el panel. En imágenes, cada miniatura puede mostrar progreso (`up`).
- `empty`: campo con borde de error (`.field.bad`), `aria-invalid="true"`, mensaje «Escribe un comentario antes de guardar.» (`:662`).
- `server`: mensaje «No se pudo guardar: el servidor local no responde. Tu comentario se conservó.» con botón «Reintentar» (`:663`).
- Error de imagen (`imgErr`): mensaje con el texto de error (`:664`). El ejemplo usa ««plan.pdf» no es una imagen. Usa PNG, JPG, WebP o GIF de hasta 5 MB.»

### 1.4 Transiciones declaradas en texto (sin código que las ejecute)

- Editar contenido: «El cambio se pinta en la página mientras escribes; “Cancelar” lo deshace» (`:512`).
- Estilos: «Vista previa en vivo sobre la página; “Revertir” o cerrar la deshace» (`:494`).
- Reordenar: «se previsualiza en la página y viaja con el comentario», reversible con «Deshacer» (`:476`, `:719`).
- Imágenes: «Se copian a .perfect-front/attachments/c-0X/ y quedan atadas a este comentario» (`:656`).
- Cola: «Quien ejecute lee la nota y los comentarios en orden antes de actuar» (`:536`).

### 1.5 Transiciones visibles en los ejemplos de muestra (estados fijos, no animados)

- Estructura con movimiento: `moves` no vacío, muestra la nota «Propuesta: mover X de la posición 3 a la 1» (`:769`).
- Cola con grupo: el comentario en borrador se inserta en la posición `g.at` (3) de la lista del grupo (`:726`).
- Animación: solo el spinner (`.spin`, `:257`), con `prefers-reduced-motion` que la anula (`:259`). Los interruptores `.sw` tienen `transition` de 0.15s (`:333`).

---

## 2. Componentes

### 2.1 Panel (`panel()`, `:607-645`)

Orden de bloques: cabecera `.p-head`, bandeja `.tray` (solo multi y no vista), franja de objetivo `.p-target`, pestañas `.p-tabs`, cuerpo `.p-body`, barra «Incluye» `.inc` (si hay algo), pie `.p-foot`. Clase `.panel`, `role="dialog"`, `aria-modal="false"`, `aria-label="Comentar"`.

- Cabecera: icono de tipo (`.p-kind`: nombre de etiqueta, número de nodos o `vista`), título, subtítulo, botón copiar (no en vista), cerrar.
- Franja de objetivo: seg «Este elemento» / «Toda la vista» (o «N elementos» en multi); navegador con botones ↑ ↓ ← →; contador de posición `N/M`; botón «Sumar»; botón «Elegir otro» (`data-act="pick"`).
- Pestañas: Comentar, Contenido, Estilos, Estructura, Cola (ver 2.2).

### 2.2 Pestañas

- **Comentar** (`commentBody`, `:653`): textarea, contador, «Descartar», zona de imágenes, miniaturas.
- **Contenido** (`contentBody`, `:667`): ver sección 5.
- **Estilos** (`stylesBody`, `:700`): ver sección 6.
- **Estructura** (`structBody`, `:714`): ver 3.3.
- **Cola** (`queueBody`, `:721`): ver 2.6.

Badges: Comentar muestra imágenes; Contenido muestra cambios de texto; Estilos muestra cambios; Estructura muestra movimientos; Cola muestra punto si hay grupo.

### 2.3 Bandeja de nodos (`.tray`, `:619`)

- Solo con varios nodos y fuera de vista.
- Un chip por nodo: número, `tag+cls` (botón de foco, `data-act="focus"`), botón quitar (`data-act="unsel"`, aria «Quitar {tag}»).
- Chip de foco: `aria-current="true"`.
- Pie de bandeja: `Shift` + «clic suma» (`:619`).

### 2.4 Barra «Incluye» (`.inc`, `:640`)

- Aparece solo si hay algo que incluir. Cada chip cambia a la pestaña correspondiente (`data-act="tab"`).
- Chips y su texto literal:
  - Nodos (solo multi y no vista): «N nodos» → Comentar.
  - Imágenes: «N imagen» / «N imágenes» → Comentar.
  - Estilos: «N cambio de estilo» / «N cambios de estilo» → Estilos.
  - Texto: si hay 1 cambio, «texto: «{resumen}»» (con `cshort`, corte a 15 caracteres + «…»); si hay más, «N textos editados» → Contenido.
  - Movimiento: «mover {from} → {to}» → Estructura.
  - Grupo: «Grupo {id} · paso {at}» → Cola.

### 2.5 Pie (`.p-foot`, `:641`)

- Atajos informativos: `Ctrl` `↵` guardar; `Esc` cancelar.
- «Cancelar» (`data-act="close"`), «Guardar» (o «Guardar en la cola» si hay grupo; «Guardando…» con spinner si `saving`).

### 2.6 Cola de lectura (`queueBody`, `:721`)

- Sin grupo: estado vacío «Este comentario va suelto», texto «Átalo a un grupo para que se lea junto con otros, en orden y con contexto.» con botones «Grupo nuevo» (`gnew`) y «Añadir a un grupo» (`gjoin`).
- Con grupo:
  - Selector de grupo: `A: Rediseño de precios`, `B: Navegación móvil`, `+ Grupo nuevo…`, y botón de salir del grupo (`gleave`, title «Sacar del grupo»).
  - Contexto del grupo: textarea (`gnote`) con la nota.
  - Interruptor «Entender el grupo antes de actuar» con subtítulo «Quien ejecute lee la nota y toda la cola, en orden».
  - Lista de cola (`.q`): ítems numerados, con chip de estado (Pendiente / En curso / Resuelto) y selector; el ítem propio aparece con borde de acento.
  - Enlace «Atar a un comentario…» (`gpick`).
- Ejemplo «Atar a un comentario» (`:818`): panel aparte con radios «Después de #1», «Después de #2», «#7 · sin grupo» (con «Se crea un grupo con ambos»), botones «Volver» y «Atar».
- Cabecera de grupo en cajón (`gcard`, `:828`): etiqueta `A`, nombre y nota; pie con «Copiar como brief» y «Añadir».

### 2.7 Pines y grupo en la página (`:821`)

- Pin `.pin` (acento, 2px de borde, forma de globo) y `.pin.done` (verde resuelto) y `.pin.g` (color de grupo «archivado»).
- Etiqueta de grupo `.gl`: «Grupo A · Rediseño de precios».
- Líneas punteadas entre pines del grupo: SVG `svg.links` con `data-link="a>b"` y `"b>c"`. Se calculan en `layout()` (`:735-753`).
- Posicionamiento por `data-at`/`data-pos`: `box`, `tr`, `below`, `left`, `right`, `top`, `ins`. Relayout en `load`, `resize` y cambio de tema.

### 2.8 Cajón de comentarios (`.drawer`, `:824-833`)

- Cabecera: «Comentarios» con «/pricing», botón cerrar.
- Pestañas: «Abiertos» (3), «Grupos» (1), «Resueltos» (1). Son markup estático sin acción en el ejemplo.
- Lista de ítems `.ci`: número (o check si está resuelto), texto, chip de estado, ruta y etiqueta de grupo (`A·1`, `A·2`, `A·3`).
- Pestaña Grupos: tarjeta de grupo y botón «Grupo nuevo».
- Dimensiones: 23rem × 36rem.

### 2.9 Lanzador (`.ln`, `:143-152`, `:829-836`)

- Grupo de botones: «Comentar» (con badge) y botón «Más opciones» (`aria-label`).
- Menú (`.menu`): estadísticas («3 abiertos», «1 grupo», «1 resueltos»), ítems «Comentarios» (badge 3), «Grupos» (badge 1), «Comentar la vista», «Atajos» con `Ctrl+⇧+C`, separador «Ocultar capa».
- Toast de confirmación (`.toast`): «Comentario #5 guardado en el grupo A» con acción «Ver».

### 2.10 Menú «Copiar ubicación» (`copyMenu`, `:646-652`)

Sección 7 detallada abajo.

---

## 3. Reglas por modo

### 3.1 Un nodo

- Identidad: título con el nombre del nodo y «en {componente}»; subtítulo con `src`.
- Copiar ubicación habilitado.
- Navegador ↑ ↓ ← → habilitado (sujeto a límites `canUp`, `canDown`, `pos`).
- Todas las pestañas habilitadas, salvo Contenido si el nodo no tiene texto propio (`content` null, tooltip «Este elemento no tiene texto propio»).
- Estilos: sin selector «Aplicar a».
- Bandeja: no se muestra.
- Pie: «Guardar».

### 3.2 Varios nodos

- Título «N elementos». Subtítulo «Foco: {tag+cls} · {archivo}».
- Bandeja visible con chips y «Shift+clic suma».
- Seg de alcance: «N elementos».
- Copiar ubicación: incluye «Los N elementos» (formato `all`) con `- ` y `⏎` (`:651`).
- Estilos: aparece «Aplicar a» con «Solo el foco» / «Los N elementos».
- Tabla de la sección 1 indica: Contenido «solo foco», Estilos «foco o todos», Estructura «solo foco». En el código el alcance de Contenido y Estructura no se bloquea por multi (solo por `content` null o vista).
- Navegador ↑↓←→ mueve solo el foco (texto en `:774`).
- Una selección de muestra usa un solo comentario con 3 nodos (`:759`, `:766`).

### 3.3 Vista (toda la página)

- Seg «Toda la vista» activo. Título «Toda la vista», subtítulo «/pricing · 3 comentarios abiertos».
- Icono de tipo «vista».
- Copiar ubicación oculto (`copy` no se renderiza).
- Navegador `.nav.off` (opacidad 0.45, sin eventos).
- Pestañas Contenido, Estilos y Estructura deshabilitadas (tooltips: «Este elemento no tiene texto propio», «Elige un elemento»).
- Bandeja oculta; «Incluye» muestra solo lo que aplica.
- Placeholder: «Qué habría que cambiar en esta vista…».

### 3.4 Estructura (pestaña)

- Ruta (`crumbs`): botones `main`, `section.plans` (por defecto).
- Caja de padre (`.parentbox`): cabecera con `parentLabel` (por defecto `div.plans`) y «N hijos · arrastra o usa ↑↓».
- Hermanos (`.sib`): icono de arrastre (sin manejador), índice, etiqueta y tooltip de texto; el seleccionado tiene `aria-current` y botones «Mover antes» / «Mover después»; los demás tienen botón «Ir» (`gosib`).
- Propuesta de movimiento: «Propuesta: mover {tag+cls} de la posición X a la Y.» con «Deshacer». Sin movimiento: «Reordenar es una propuesta…».
- Ambigüedad: la cabecera dice «arrastra o usa ↑↓», pero en el resto del panel ↑↓ es navegación padre/hijo (`:624`). Hay que definir si ↑↓ en Estructura reordena o navega. Decisión de diseño, no la tomo aquí.

---

## 4. Atajos de teclado y navegación

Atajos literales que aparecen en el markup. Ninguno tiene `keydown` implementado en el prototipo.

| Tecla | Dónde aparece | Texto / acción declarada |
|---|---|---|
| `↑` | Navegador (`:624`), hint (`:774`), barra (`:764`) | «Padre (↑)» (title); «padre / hijo» |
| `↓` | Navegador (`:624`) | «Hijo (↓)» (title); aria «Primer hijo (↓)» |
| `←` | Navegador (`:625`), barra (`:764`) | «Hermano anterior (←)»; «hermanos» |
| `→` | Navegador (`:625`), barra (`:764`) | «Hermano siguiente (→)»; «hermanos» |
| `Shift`+clic | Bandeja (`:619`), barra selección (`:766`), botón Sumar (`:627`) | «Sumar»; «quita o suma» (barra) |
| `Ctrl`+`↵` | Pie (`:641`) | «guardar» |
| `Esc` | Pie (`:641`), botón cerrar (`:618`), barra (`:764`) | «cancelar»; «Cerrar (Esc)»; «salir» |
| `Ctrl`+`V` | Zona de imágenes (`:658`) | «Pega (Ctrl+V)» |
| `Ctrl`+`⇧`+`C` | Menú del lanzador (`:835`) | Ítem «Atajos» |

Navegación por la estructura: ↑ sube al padre, ↓ baja al primer hijo, ← y → van al hermano anterior y siguiente. Límites: `pos<=0` deshabilita ←, `pos>=nsib-1` deshabilita →, `canUp===false` deshabilita ↑, `canDown===false` deshabilita ↓. Vista deshabilita todo el navegador.

Sin texto de ayuda para: foco por teclado en cajón, atajos de pestañas, y acceso a «Copiar» por teclado.

---

## 5. Imágenes

- Zona `.dz` en la pestaña Comentar (`:657-658`).
  - Reposo: «**Pega** (Ctrl+V), **arrastra** o abre imágenes», botón «Abrir…» y botón de captura (icono de cámara, title «Captura de la página», sin etiqueta).
  - Arrastrando (`dropping`): bloque `.dz.over` con «Suelta para adjuntar» y «PNG, JPG, WebP o GIF · hasta 5 MB c/u».
- Pegar: solo texto del atajo. No hay manejador de `paste`.
- Soltar: solo estado visual `dropping`. No hay manejador de `drop`.
- Abrir: botón «Abrir…». Sin manejador.
- Captura: botón sin manejador.
- Adjuntas (`.thumbs`, 3 columnas): por imagen, fondo (`url` o gradiente), etiqueta opcional (`k`, por ejemplo «captura»), barra de progreso (`up`), botón quitar (aria «Quitar {nombre}»), nombre y tamaño.
- Ruta de destino (`.dest`): «Se copian a **.perfect-front/attachments/c-0{04|05}/** y quedan atadas a este comentario». El `05` aparece cuando `live` es verdadero.
- Reubicar: no hay control de reubicación de imágenes. Solo se muestra la ruta de destino.
- Límite: el texto de la introducción dice «el esquema ya admite hasta 20 adjuntos» (`:522`). En el código no hay contador ni bloqueo a 20. Solo se valida el tamaño en texto («hasta 5 MB c/u»).
- Estados de carga: `status:'saving'` deshabilita «Abrir…» y captura; barra por miniatura (`up`).
- Error: `imgErr` con el texto de error.
- Ejemplos de muestra: «Reposo», «Arrastrando», «Adjuntas» (con `IMGS`: `captura-pantalla.png` 412 KB, `figma-card.png` 188 KB, `ref-movil.jpg` 96 KB), «Subiendo» (62 % y 18 %), «Archivo no válido».

---

## 6. Estilos: editable vs. foundation

### 6.1 Clasificación (texto de `:484` y `:487-491`)

- **Editable**: regla declarada en archivos del proyecto (módulos CSS, Tailwind en JSX, styled/inline, CSS global propio). Clase `.lg.ed` (`:708`).
- **Foundation**: variables de `:root`/tema, tokens, reset/preflight, estilos de `node_modules` y valores heredados del navegador. Clase `.lg.lk`.
- **Usa un token**: la propiedad es editable, el token es foundation. Se muestra con `usa <token>` (`:706`).

### 6.2 Filas editables (`STY.groups`, `:585-588`)

- Tipografía: `font-size` 14 px (num, `PricingCard.module.css:18`); `font-weight` 500 (select 400/500/600/700, `:19`).
- Espaciado: `padding-inline` 14 px (`:21`); `padding-block` 7 px (`:20`).
- Color y forma: `background` `#2f5bea` (color, token `--pf-color-accent`); `color` `#ffffff` (color, token `--pf-color-accent-fg`); `border-radius` 8 px (num, token `--pf-radius-md`).
- Controles: número con unidad, texto de color con muestra, select.
- Fila cambiada (`.chg`): «antes → después» en la leyenda; botón «Revertir» por fila (deshabilitado si no hay cambio).
- Resumen: «N cambio(s) propuesto(s). Vista previa activa; el código no se toca.» con «Revertir todo».

### 6.3 Foundations (`STY.fnd`, `:589-595`), solo lectura

- Cabecera colapsable: «Foundations · solo lectura» con badge de cantidad (6 en el ejemplo).
- Filas: `font-family` (`design-tokens · --pf-font-sans`); `line-height` 1.5 (`base.css · reset`); `box-sizing` border-box (`preflight (Tailwind)`); `--pf-color-accent` #2f5bea (`design-tokens/tokens.css:14`); `--pf-radius-md` 8px (`tokens.css:62`); `--pf-space-3` .75rem (`tokens.css:55`).
- Botón «Comentar» por fila: agrega la referencia al texto del comentario (`data-act="fcom"`), no un cambio. Sin manejador.

### 6.4 Qué se guarda (`:492-497`)

- Lista «antes → después» por propiedad, ligada al comentario. No modifica el código fuente (SPEC citada en el texto).
- Vista previa en vivo; «Revertir» o cerrar la deshace.
- Selección múltiple: «Aplicar a» foco o todos.

---

## 7. Copiar ubicación (`:646-652`, `:617`)

- Botón `copy` en la cabecera (no en vista). Abre un menú `role="menu"` titulado «Copiar como».
- Ítems:
  - `file`: «Archivo y línea» (valor `src`, p. ej. `src/components/PricingCard.tsx:42`).
  - `sel`: «Selector CSS» (valor `sel`).
  - `pf`: «Referencia Perfect Front» (valor `pf://pricing#` + último segmento del selector).
  - `md`: «Markdown para pegar» (valor `` `src` · `tag+cls` en /pricing ``).
  - `all` (solo varios): «Los N elementos».
- Confirmación: el ítem copiado muestra «¡Copiado!» (`.done`); los demás muestran icono de copia.
- Clic simple: el texto de `:529` dice que copia «archivo:línea» con un clic. El prototipo no implementa el clic simple. Solo muestra el menú.
- Texto explicativo por formato (`:806-811`): archivo y línea para PR o editor; selector para tests y DevTools; referencia pf:// para pegar dentro de otro comentario; markdown para issue o prompt.

---

## 8. Contenido: texto y traducciones

### 8.1 Tres casos (`CT_*`, `:597-599`, `contentBody` `:667`)

- **Texto fijo** (`fixed`): icono de texto, título «Texto fijo», subtítulo «Escrito directo en el código», ubicación `c.src`. Textarea de nuevo texto y bloque «Antes/Después».
- **Clave i18n** (`i18n`): icono de globo, «Clave i18n», subtítulo «Se traduce desde archivos de idioma», ubicación `locales/{lang}.json`, etiqueta `react-i18next`, «en uso: N». Clave en `<code>`.
  - Selector de idioma ES / EN / PT (`data-act="lang"`) con punto de estado: `ed` (acento, editada), `miss` (pendiente, sin traducir), sin clase (sin cambios).
  - Alcance del cambio: radio «Todas las apariciones» (`scope:'all'`, «La clave se usa en N lugares y cambiarían todos.») y «Solo aquí» (`scope:'one'`, «Se propone una clave nueva: {clave}_2.»).
  - Tabla «Todos los idiomas» (`lrows`): fila por idioma, «sin traducir» en cursiva si falta.
  - Falta de traducción: «Falta la traducción a {LANG}. En la página se ve en ES (fallback).» (la palabra ES está fija en el texto, `:692`).
  - Placeholder de textarea sin traducir: «Sin traducir. Escribe la traducción a {LANG}…».
- **Dinámico** (`dyn`): icono de enlace, «Dinámico», subtítulo «Mezcla texto fijo con datos». Variables `{nombre}` como chips `.vchip` (bloqueadas, icono de candado, texto «Variables fijas:»).
  - Si falta una variable: «Falta {x} en el texto. Las variables vienen del código y no se pueden quitar.» (error).
  - Vista previa: «Vista previa: **…**» con variables sustituidas.

### 8.2 Diferencia y avisos (`diffBlock`, `:674-677`)

- Sin cambios: «Sin cambios todavía. Escribe arriba y verás el resultado en la página.»
- Con cambios: bloques «Antes» (tachado) y «Después» (subrayado, verde).
- Aviso de longitud: si el texto nuevo es más largo que el original en más de 25 % y al menos 6 caracteres, «N% más largo: puede desbordar el diseño. Revísalo en la vista previa.»

### 8.3 Pie de contenido (`:698`)

- «Al guardar, el cambio viaja con el comentario como «antes → después».»
- Si el borrador está vacío: «Si no escribes nada, se genera: «Cambiar texto de … a …».»
- Nota: la generación automática no está en el código; el texto solo describe la regla.

### 8.4 Sin texto propio

- Estado vacío: «Este elemento no tiene texto propio» / «Elige un botón, título o párrafo para editar su contenido.» (`:669`).
- En el panel la pestaña Contenido queda deshabilitada, con tooltip «Este elemento no tiene texto propio» (`:629`).

### 8.5 Vista previa en la página (`:791`)

- Selector de idioma flotante `.lpill` (ES, EN, PT; ES activo).
- Barra: «Editando texto · vista previa en ES», botón «Revertir».
- Hint en el elemento: «button.cta · texto editado».

---

## 9. Textos de UI literales

Agrupados por zona. Se reproducen tal como están en el código; los nombres de clave y rutas se conservan.

### 9.1 Cabecera de página y temas (`:407-413`)

- «Perfect Front · capa de comentarios v2»
- Navegación: «Jerarquía», «Panel», «Navegar y reordenar», «Estilos», «Contenido», «Imágenes», «Ubicación», «Grupos y cola», «Cajón»
- Tema: «Tema» (aria), «Auto», «Claro», «Oscuro»

### 9.2 Hero y secciones

- «Ocho funciones nuevas sin que el panel se vea revuelto.»
- «La regla: cada zona responde una sola pregunta y las funciones aparecen solo cuando tienen sentido. Escribir un comentario y revisar los existentes dejan de compartir pantalla.»
- Títulos de sección: «Jerarquía de la información», «El panel con todo integrado», «Navegar, sumar y reordenar», «Estilos: editable vs. foundations», «Contenido: editar un texto y ver cómo queda», «Imágenes: pegar, soltar o abrir», «Copiar la ubicación de un nodo», «Grupos y cola de lectura», «Cajón de comentarios · lanzador · selección».
- Verbos: «1 · Apuntar» («¿A qué nodos me refiero?»), «2 · Describir» («¿Qué debería cambiar?»), «3 · Organizar» («¿Con qué otros se entiende?»).

### 9.3 Jerarquía y tabla (`:427-461`)

- Niveles: «Lanzador» («Siempre presente. Entrada al editor y al cajón.»), «Barra de selección» («Solo mientras eliges. Teclas, no frases.»), «Editor (panel)» («Un solo comentario en construcción.»), «Identidad» («Qué nodo es + copiar ubicación.»), «Objetivo» («Alcance, navegador 4 direcciones, sumar nodos.»), «Contenido por pestañas» («Comentar · Contenido · Estilos · Estructura · Cola.»), «Incluye + acciones» («Resumen de lo adjunto y Guardar.»), «Cajón de comentarios» («Leer, filtrar y ordenar grupos. Aparte del editor.»).
- Tabla «Qué aparece cuándo»: columnas «Pieza», «Reposo», «Eligiendo», «1 nodo», «Varios», «Vista». Filas: Lanzador (compacto en 1 nodo, varios y vista); Barra de selección; Identidad + copiar (en vista: «sin copiar»); Bandeja de nodos; Navegador ↑↓←→ (en vista: «apagado»); Pestaña Comentar; Pestaña Contenido («si tiene texto», «solo foco», «apagada»); Pestaña Estilos («foco o todos», «apagada»); Pestaña Estructura («solo foco», «apagada»); Pestaña Cola; Barra «Incluye» («si hay algo»); Cajón («desde menú», «se cierra»).
- Reglas (`:461`): «(1) lo que cambia el contexto (qué nodo) está fuera de las pestañas y siempre visible; lo que cambia el contenido va dentro. (2) Lo que no aplica se oculta si es ruido (bandeja) o se apaga si el usuario lo espera ahí (pestañas). (3) Lo raro va en un menú (copiar formatos). (4) Lo que ya está en el comentario se resume en «Incluye» para no tener que abrir pestañas a ver qué hay.»

### 9.4 Panel (`:616-644`, `:659-698`, `:707-719`, `:730`, `:754`)

- Cabecera: «Copiar ubicación» (title y aria), «Cerrar (Esc)».
- Bandeja: «Elementos seleccionados» (aria), «Shift+clic suma», «Quitar {tag}».
- Alcance: «Este elemento», «Toda la vista», «N elementos», alcance aria «Objetivo del comentario».
- Navegador: aria «Moverse por el DOM»; títulos «Padre (↑)», «Hijo (↓)», «Hermano anterior (←)», «Hermano siguiente (→)», «Posición entre hermanos»; botones «Sumar» (title «Sumar otro elemento (Shift+clic)»), «Elegir otro elemento» (title «Elegir otro»).
- Pestañas: «Comentar», «Contenido», «Estilos», «Estructura», «Cola»; tooltips «Este elemento no tiene texto propio», «Elige un elemento».
- Comentar: placeholder «Qué habría que cambiar» + « en este elemento…» / « en estos elementos…» / vista «Qué habría que cambiar en esta vista…» (texto literal con `…`). Botón «Descartar». Contador «N / 10.000». Mensajes de error (ver 1.3). Zona de imágenes (ver 5).
- Pie: «Ctrl», «↵», «guardar», «Esc», «cancelar», «Cancelar», «Guardar», «Guardar en la cola», «Guardando…».
- Estilos: (leyenda: «Editable» / «Vive en el código del proyecto»; «Foundation» / «Tokens, reset y librerías»), «Aplicar a», «Solo el foco», «Los N elementos», «Foundations · solo lectura», «Revertir», «Revertir todo», «Comentar», «Vista previa activa; el código no se toca.», «cambio(s) propuesto(s)».
- Estructura: «Ruta», «N hijos · arrastra o usa ↑↓», «Mover antes», «Mover después», «Ir», «Propuesta: mover … de la posición … a la …», «Deshacer», «Reordenar es una propuesta: se previsualiza en la página y viaja con el comentario. El código no cambia.»
- Cola: «Este comentario va suelto», «Átalo a un grupo para que se lea junto con otros, en orden y con contexto.», «Grupo nuevo», «Añadir a un grupo», «Grupo» (aria), «Sacar del grupo», «Contexto del grupo», «Entender el grupo antes de actuar», «Quien ejecute lee la nota y toda la cola, en orden», «Cola de lectura», «Atar a un comentario…», «Este comentario (borrador)», «nuevo».
- Atar (`:818`): «Atar a un comentario», «Se coloca justo después del elegido», «Después de #1», «Después de #2», «#7 · sin grupo», «Se crea un grupo con ambos», «Volver», «Atar».
- Incluye: «Incluye», «nodos», «imagen», «imágenes», «cambio de estilo», «cambios de estilo», «textos editados», «texto:», «mover», «Grupo», «paso».
- Pines y grupo: «Grupo A · Rediseño de precios».

### 9.5 Copiar (`:646-652`)

- «Copiar como», «Archivo y línea», «Selector CSS», «Referencia Perfect Front», «Markdown para pegar», «Los N elementos», «¡Copiado!».

### 9.6 Imágenes (`:657-664`, `:732-799`)

- «Pega», «arrastra», «abre imágenes», «Abrir…», «Captura de la página», «Suelta para adjuntar», «PNG, JPG, WebP o GIF · hasta 5 MB c/u», «Se copian a», «y quedan atadas a este comentario», «Quitar {nombre}», error de tipo ««{archivo}» no es una imagen. Usa PNG, JPG, WebP o GIF de hasta 5 MB.», «Reintentar».

### 9.7 Contenido (`:669-698`, `:791`)

- «Este elemento no tiene texto propio», «Elige un botón, título o párrafo para editar su contenido.», «Texto fijo», «Escrito directo en el código», «Clave i18n», «Se traduce desde archivos de idioma», «Dinámico», «Mezcla texto fijo con datos», «en uso:», «Idioma», «Sin traducir.», «Falta la traducción a», «En la página se ve en ES (fallback).», «Alcance del cambio», «Todas las apariciones», «Solo aquí», «Se propone una clave nueva», «Variables fijas:», «Falta … en el texto. Las variables vienen del código y no se pueden quitar.», «Vista previa:», «Antes», «Después», «Sin cambios todavía. Escribe arriba y verás el resultado en la página.», «puede desbordar el diseño. Revísalo en la vista previa.», «Al guardar, el cambio viaja con el comentario como «antes → después».», «Si no escribes nada, se genera: «Cambiar texto de … a …».», «Editando texto · vista previa en ES», «Revertir».

### 9.8 Lanzador, cajón y toast (`:824-836`)

- «Comentar», «Selecciona…», «Más opciones», «Comentarios», «Grupos», «Comentar la vista», «Atajos», «Ocultar capa», «abiertos», «grupo», «resueltos», «Ver», «Comentario #5 guardado en el grupo A».
- Cajón: «Comentarios», «/pricing», «Abiertos», «Grupos», «Resueltos», «Grupo nuevo», «Copiar como brief», «Añadir», «Rediseño de precios», «Primero el contenedor, luego las tarjetas y al final el CTA.»

### 9.9 Página de muestra (`:734`, `:764-766`, `:791`)

- Página: «Perfect», «Planes», «Docs», «Entrar», «Precios claros para equipos», «Elige un plan y cámbialo cuando quieras.», «Básico / Para empezar», «Pro / Para equipos», «Empresa / Soporte dedicado», «Elegir plan», «Hablar».
- Barras: «padre / hijo», «hermanos», «Shift+clic sumar», «Salir»… (literal: «Esc salir»), «Reordenando», «Deshacer», «Listo», «Mover de 3 a 1», «3 elementos · un solo comentario», «Shift+clic quita o suma», «Comentar selección».

### 9.10 Literales con detalle a revisar

- Contraste de textos de ejemplo en el propio panel: «El botón queda pegado al borde en móvil; faltan 8px de padding.» (`:758`), «Alinear los tres con la misma rejilla de 8px.» (`:759`), «La página entera se siente apretada en tablet.» (`:760`), «Revisar el contraste del botón.» (`:816`).
- Nota de grupo de muestra: «Mantener la rejilla de 3 columnas.» (`:602`).

---

## 10. Observaciones y ambigüedades

1. Prototipo estático: los `data-act` no tienen manejador. Atajos, arrastre, pegado, carga de imágenes, guardado y menú de copiar no funcionan en este archivo. Solo se ven los estados.
2. Estructura: conflicto entre ↑↓ de navegación (padre/hijo) y «arrastra o usa ↑↓» en la cabecera de hermanos.
3. Imágenes: el límite de 20 adjuntos solo aparece en texto de introducción; no hay contador ni bloqueo.
4. Cajón: la tabla indica que se cierra en varios estados, pero no hay código que lo haga.
5. Clases CSS sin uso en el markup: `.hint-tip` (`:135`), `.pin-pop` (`:399-401`), `.sib.moved` (`:312`).
6. Literal «ES» fijo en el aviso de fallback (`:692`), aunque el resto del texto usa el idioma activo.
7. Atajo `Ctrl+⇧+C` aparece como «Atajos» en el menú, sin definición de qué abre.
8. Clic simple en «Copiar ubicación» se describe en texto (`:529`), sin implementación.
