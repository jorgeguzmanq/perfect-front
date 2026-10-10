# Project detector

Detección pura y comprobable de raíz, gestor de paquetes, framework, comando de desarrollo, puerto y URL. Vite será el primer adaptador.

## HTML estático

Sin Vite ni runner conocido, pero con `.html`, `detectProject` devuelve `kind: "static"` y `static: { pages, entry, status, choice, truncated }`. `plan` es solo un marcador (`source: "static"`): quien sirve la carpeta (el CLI) lo reemplaza. Elección: `overrides.page` > `entry` de project.json > `index.html` en la raíz > página única > `status: "needs_choice"` (no es error). `overrides.choose` ignora lo anterior salvo `page`. Una página inválida (absoluta, `..`, fuera de la lista) lanza `DetectionError("invalid_command")`. Candidatas: raíz primero; si no hay HTML, subcarpetas hasta profundidad 2 sin `node_modules`, `dist`, `build`, `.git`, `.perfect-front` ni dotdirs; máx. 200 (`truncated`). Fixtures: `static-index`, `static-multi`, `static-single`, `static-nested`. La detección sigue siendo pura.
