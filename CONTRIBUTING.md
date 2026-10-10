# Contribuyendo a Perfect Front

Bienvenido. Este documento describe cómo preparar tu entorno, ejecutar tareas comunes y mantener la calidad del código.

## Requisitos

- **Node.js**: versión 22 o superior (comprueba con `node --version`)
- **pnpm**: versión 11.9.0 o superior (comprueba con `pnpm --version`)

## Instalación

```bash
pnpm install
```

## Comandos raíz

Desde la raíz del workspace:

```bash
pnpm run dev         # Inicia servidores de desarrollo de todos los paquetes
pnpm run build       # Construye todos los paquetes
pnpm run typecheck   # Ejecuta TypeScript en modo verificación
pnpm run lint        # Ejecuta ESLint en el código
pnpm run test        # Ejecuta pruebas unitarias e integración
pnpm run test:e2e    # Ejecuta pruebas end-to-end con Playwright
```

## Reglas de ejecución

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

## Commits

Utilizamos [Conventional Commits](https://www.conventionalcommits.org/) en inglés.

Ejemplos:

```
feat: add ESLint configuration for Phase 0
fix: resolve race condition in storage service
chore: update dependencies
docs: clarify API contract in SPEC.md
test: add integration tests for comment creation
```

## Definición global de terminado

Una funcionalidad solo está terminada cuando:

- [ ] cumple el contrato documentado;
- [ ] valida entradas desconocidas;
- [ ] tiene pruebas proporcionales al riesgo;
- [ ] maneja errores sin perder comentarios;
- [ ] no amplía permisos innecesariamente;
- [ ] funciona desde la raíz del workspace;
- [ ] actualiza documentación si cambia una decisión;
- [ ] no deja procesos, archivos temporales o listeners huérfanos.

## Calidad de código

- ESLint se ejecuta automáticamente con `pnpm run lint`.
- Prettier formatea el código según `.prettierrc.json`.
- Todos los archivos deben validar con TypeScript strict.

## Estructura del workspace

Este es un workspace de pnpm con múltiples paquetes independientes. Cada paquete tiene su propio `package.json` y `node_modules`. Consulta `PLAN.md` y los archivos `CLAUDE.md` específicos de cada paquete para instrucciones de desarrollo.
