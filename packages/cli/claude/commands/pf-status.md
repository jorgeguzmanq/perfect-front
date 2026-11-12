---
description: Muestra el estado de Perfect Front en el proyecto actual (servidor y proceso, conteo de comentarios por estado y cola pendiente)
argument-hint: ""
allowed-tools: Bash
---

# /pf-status — estado de Perfect Front

Solo lectura; no cambies nada.

1. `perfect-front status --json` desde la raíz del proyecto: proceso del dev server, proxy y URL del proyecto (si sale «detenido», dilo y sugiere `perfect-front` o `perfect-front --detach`).
2. `perfect-front list --status all --json` y cuenta por `status` (pending, in_progress, resolved, ignored, archived). Si hay `errors` (JSON ilegible), menciónalos.
3. Para los `pending`, mira `perfect-front show <id> --json` solo si hace falta ver `group`; muestra la cola agrupada por grupo en orden de `group.position` (nombres en `.perfect-front/groups.json`) y los sueltos aparte.
4. Responde corto: URL, conteos y los siguientes pendientes (id · ruta · texto resumido). Si hay peticiones sin tomar en `.perfect-front/agent-inbox/` con `status: "pending"`, indícalo y sugiere `/pf-watch`.
