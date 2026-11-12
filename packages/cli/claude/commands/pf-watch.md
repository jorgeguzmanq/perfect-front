---
description: Deja `perfect-front watch` corriendo bajo Monitor para atender las peticiones «Enviar a agente» del widget
argument-hint: "[--interval <ms>]"
allowed-tools: Bash, Monitor
---

# /pf-watch — atender peticiones del widget

Argumentos: `$ARGUMENTS` (se pasan tal cual a `watch`, p. ej. `--interval 2000`).

1. Comprueba que estás en la raíz del proyecto (`.perfect-front/` existe). Si no, dilo y para.
2. Lanza `perfect-front watch $ARGUMENTS` bajo **Monitor** (proceso largo, SIN `--once`; no uses sleep ni polling). Cada petición pendiente del widget aparece como `Petición <id>: N comentario(s) → ids` seguida del bloque `───── PROMPT PARA TU AGENTE ─────` ... `───── FIN ─────`, y queda marcada `taken`.
3. Avisa en una línea que quedó escuchando y no hagas nada más hasta que llegue una petición.
4. Cuando llegue una: el prompt solo trae ids, conteo, grupo y rutas. Lee el contenido con `perfect-front show <id> --json` y resuelve siguiendo `/pf` (reclamar con `claim`, orden de cola del grupo, verificar y `resolve`). Con una petición de grupo, atiende los ids en el orden recibido.
5. Cuando la persona diga que basta, detén el Monitor.

Si `perfect-front` no está en el PATH: `node Z:\Dev\perfect-front\packages\cli\bin\comment.mjs watch`. Contrato: `~/.claude/skills/perfect-front/SKILL.md`.
