---
description: Resuelve de punta a punta los comentarios pendientes de Perfect Front del proyecto actual (reclama, corrige, verifica y registra con resolve, en el orden de la cola)
argument-hint: "[pf_ID ... | --grupo <id> | --solo-leer]"
---

# /pf — ciclo completo de comentarios Perfect Front

Trabajas sobre la carpeta actual. Antes de empezar, lee `~/.claude/skills/perfect-front/SKILL.md` (contrato de la CLI, grupos, propuestas y reglas) si no lo tienes en contexto.

Argumentos: `$ARGUMENTS` (vacío = todos los pendientes; ids o prefijos = solo esos; `--grupo <id>` = la cola de ese grupo; `--solo-leer` = triage sin tocar nada).

## 1. Detectar

1. `perfect-front list --json` desde la raíz del proyecto (solo `pending`). Si sale 3 (sin `.perfect-front`) o falla, dilo y para.
2. Filtra a lo pedido en `$ARGUMENTS`. Si hay 0: «Sin comentarios pendientes» y termina.
3. Con `--solo-leer`: tabla (id · ruta · texto resumido · estado) y para.
4. Por cada candidato `perfect-front show <id> --json` para ver `group`, `extraTargets`, `proposals`, `sections` y adjuntos. Si hay `groups.json`, léelo.

## 2. Orden

- Los comentarios con `group` se atienden agrupados, en orden de `group.position`, y **nunca** se empieza uno sin haber resuelto y verificado el anterior de su grupo. Si el grupo tiene `readFirst: true`, lee la nota y toda la cola antes de actuar.
- Sueltos y grupos distintos son independientes. Dos comentarios que tocan el mismo archivo se hacen seguidos por la misma mano, nunca en paralelo.
- Si hay ambigüedad real (copy sin definir, dos lecturas válidas), pregunta a la persona (todas las dudas en una sola ronda) y avanza mientras con lo directo.

## 3. Resolver cada comentario

1. `perfect-front claim <id> --expect-updated-at <updatedAt>`.
2. Localiza el elemento (ruta → texto → selectores → HTML → captura) y cambia el código siguiendo el SKILL. Un comentario con `extraTargets` es una sola tarea sobre todos los elementos; las `proposals` se aplican tal cual.
3. **Verifica de verdad**: build/lint/tests del proyecto y, si es visual y hay servidor, inspección real (la URL del proyecto la da `perfect-front status`); si no, revisa el diff. Sin verificar no se resuelve.
4. `perfect-front resolve <id> --summary "qué cambió y por qué" --files a,b --verification "<qué comprobaste>" --by agent`.
5. Si no localizas con confianza o falta una decisión: no resuelvas. `edit --comment` conservando el texto original + `[Agente] ...` con lo probado, y deja el estado en `in_progress`/`pending`; los pasos siguientes de su grupo quedan abiertos con esa razón.

## 4. Ciclo

Tras cada tanda: `perfect-front list --json` otra vez (la persona puede seguir comentando). Si aparecieron pendientes nuevos, vuelve al paso 2. Termina con 0 pendientes o solo los que esperan respuesta.

## 5. Reporte y reglas

- Un solo reporte al final: resueltos (id + una línea), abiertos con su razón, archivos tocados.
- No hagas `git commit/push`; ofrece preparar el commit y espera el sí. No borres comentarios (`delete`) ni uses `ignore` sin que la persona lo pida.
- No edites `.perfect-front/` a mano: solo la CLI.
