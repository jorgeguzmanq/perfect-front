# Scripts

## demo-sprint1.ts

Demostración del primer corte de `PLAN.md` (fases 0-3):

- Detecta un proyecto Vite usando `@perfect-front/project-detector`
- Inicializa storage con `@perfect-front/comment-storage`
- Crea un comentario simulado, lo mueve entre colecciones
- Exporta a Markdown

**Ejecutar:**

```bash
pnpm node --experimental-strip-types scripts/demo-sprint1.ts
```

`pnpm node` resuelve los imports del workspace correctamente. Requiere Node.js 22.0+.
