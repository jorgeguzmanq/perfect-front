# @perfect-front/source-plugin

Anota cada elemento JSX con `data-pf-src="ruta/relativa:línea:columna"` para que la capa de Perfect Front sepa el archivo y la línea exactos de lo que se comenta (y pueda abrirlo en el editor).

- `annotateJsx(code, filePath, root)`: transformador puro. La inserción es siempre en la misma línea, así que no cambian los números de línea y no hace falta sourcemap. Devuelve `null` si no hay nada que anotar.
- `perfectFrontSource()`: plugin Vite (`enforce: "pre"`), solo `.jsx`/`.tsx`, solo en dev (`serve`), ignora `node_modules`.
- `writeWrapperConfig({ stateDir, projectDir })`: escribe `<stateDir>/wrappers/<hash>/vite.pf.config.mjs`, que importa la config del usuario y le antepone el plugin. **Nunca escribe en el proyecto del usuario.** El CLI lo usa con `vite --config <envoltorio>` al detectar Vite + React; `--no-source` lo desactiva.

Limitaciones conocidas del escáner (no es un parser): un elemento que sigue a texto JSX en la misma expresión (`<p>hola <b>x</b></p>`) puede quedar sin anotar; las cadenas con `<` y los genéricos de TS se respetan.

## TODO

- **Next.js**: no hace falta plugin; la capa lo cubre desde el overlay (`packages/overlay/src/next-source.ts`, lee `_debugStack` de React 19 y lo traduce con el dev server de Next).
- **Angular**: pendiente, no implementado. Las plantillas no son JSX; haría falta un transformador de plantillas (`@angular/compiler`) o un builder personalizado.
