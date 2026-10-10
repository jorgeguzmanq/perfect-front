# Perfect Front

Perfect Front será una herramienta local de revisión visual para proyectos web. Desde la raíz de un proyecto, el comando `comment` conectará o iniciará su servidor de desarrollo, abrirá la aplicación en Chrome y permitirá activar una capa de comentarios mediante una extensión.

Este repositorio contiene por ahora el scaffold arquitectónico y la documentación del producto. Todavía no contiene una aplicación ejecutable.

## Documentos

- [`SPEC.md`](./SPEC.md): especificación del producto, arquitectura y contratos.
- [`PLAN.md`](./PLAN.md): implementación paso a paso, pruebas y criterios de salida.

## Estructura

```text
apps/dashboard       Centro web de proyectos y comentarios
apps/extension       Extensión Chrome Manifest V3
packages/cli         Binario `comment`
packages/local-server API local, eventos y procesos
packages/overlay     Capa visual inyectada en las páginas
packages/project-detector Detección de frameworks, comandos y puertos
packages/comment-storage Persistencia de comentarios y colecciones
packages/shared      Contratos, esquemas y utilidades compartidas
packages/design-tokens Tokens y estilos base compartidos por dashboard, popup y overlay
```

No instales dependencias hasta ejecutar la fase 0 de `PLAN.md`, donde se deben cerrar las decisiones técnicas aún abiertas.
